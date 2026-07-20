import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getProject, updateProject, logActivity } from '@/lib/project-service';
import { listFolderFiles, extractDocumentText } from '@/lib/google-drive';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Dynamically generate Google Application Credentials from Firebase Env Vars
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_PRIVATE_KEY) {
  const tmpPath = path.join(os.tmpdir(), '.gcp-temp-key.json');
  if (!fs.existsSync(tmpPath)) {
    fs.writeFileSync(tmpPath, JSON.stringify({
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL
    }));
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
}

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    delete process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_CLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    _ai = new GoogleGenAI({ vertexai: true });
  }
  return _ai;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const project = await getProject(projectId);
    
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const driveFolderId = project.driveFolderId;
    if (!driveFolderId) {
      return NextResponse.json({ error: "No Google Drive folder is linked to this project" }, { status: 400 });
    }

    // 1. Fetch files from linked Drive folder
    const files = await listFolderFiles(driveFolderId);
    const supportedFiles = files.filter(f => 
      f.mimeType === 'application/vnd.google-apps.document' || 
      f.mimeType === 'application/vnd.google-apps.spreadsheet' ||
      f.mimeType === 'text/plain' || 
      f.mimeType === 'text/markdown' ||
      f.mimeType === 'application/json' ||
      f.mimeType === 'text/csv'
    );

    if (supportedFiles.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: "No supported documents found in the Google Drive folder" 
      }, { status: 400 });
    }

    const extractedTexts = [];
    for (const doc of supportedFiles) {
      if (doc.id && doc.mimeType) {
        try {
          const text = (await extractDocumentText(doc.id, doc.mimeType)) as string;
          extractedTexts.push(`--- Document: ${doc.name} ---\n${text.substring(0, 10000)}`);
        } catch (err) {
          console.warn(`Failed to read document ${doc.name}`, err);
        }
      }
    }

    if (extractedTexts.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: "Could not extract text from any documents" 
      }, { status: 400 });
    }

    const driveContext = extractedTexts.join('\n\n');

    // 2. Synthesize using Gemini
    const systemInstruction = `You are a Senior Zoho CRM Solutions Architect and Business Analyst.
Your task is to analyze Google Drive documentation (meeting notes, requirements, data dictionaries, processes) and synthesize a premium, structured project context and configuration specification.

You will be provided with:
1. Any existing requirements/specifications of the project (if they exist).
2. The newly synced Google Drive documentation.

Your goal is to perform a comprehensive synthesis. You must return a single JSON object with the following fields:
- projectContext: A highly detailed log of what exactly is happening in the project. Whenever new files or information are added, clearly state what was discussed and list the specific requirements derived from it (e.g., creation of new fields, modules, workflows, reports, layouts, etc.). This area retains the context so new requirements can be continuously added without disregarding previous ones.
- overallRequirements: A beautiful, comprehensive Markdown string outlining cumulative customer goals, business context, general constraints, and a list of files synced. Maintain and integrate existing requirements if present.
- crmRoadmap: A detailed Markdown roadmap listing:
  * Identified Zoho Modules and layouts (Standard or Custom).
  * Custom Fields needed per module, with explicit data types (e.g. Picklist, Checkbox, Text, DateTime) and required status.
  * Workflows and automations (actions, triggers).
  * Layout requirements, validation rules, reports/dashboards.
- plannedTools: A clean, clear Markdown list of technical tasks and tools we are going to use (e.g. list_tools, create_module, add_fields) required to achieve the project requirements.

If existing specifications are provided, you MUST preserve the manual requirements and evolve them rather than overwriting or deleting custom info. Integrate new findings seamlessly.

IMPORTANT: Your response must be valid JSON matching this schema exactly:
{
  "projectContext": "string",
  "overallRequirements": "string",
  "crmRoadmap": "string",
  "plannedTools": "string"
}
Do not wrap in anything else. Just the JSON object.`;

    const userPrompt = `
EXISTING PROJECT CONTEXT:
- Project Context Area: ${project.projectContext || 'None'}
- Overall Requirements: ${project.overallRequirements || 'None'}
- CRM Roadmap: ${project.crmRoadmap || 'None'}
- Planned Tools: ${project.plannedTools || 'None'}

NEWLY SYNCED GOOGLE DRIVE DOCUMENTATION:
=========================================
${driveContext}
=========================================

Synthesize the updated requirements, roadmaps, and next steps.`;

    const response = await getAI().models.generateContent({
      model: 'gemini-2.5-pro',
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Failed to get synthesis from Gemini");
    }

    const synthesis = JSON.parse(resultText);

    // 3. Update Firestore Project
    const updates = {
      projectContext: synthesis.projectContext,
      overallRequirements: synthesis.overallRequirements,
      crmRoadmap: synthesis.crmRoadmap,
      plannedTools: synthesis.plannedTools,
      lastSync: new Date().toISOString()
    };

    await updateProject(projectId, updates);

    // 4. Log the sync activity
    await logActivity(
      projectId,
      'settings_update',
      `Synced requirements from Google Drive folder`,
      { 
        filesSyncedCount: supportedFiles.length,
        syncedFiles: supportedFiles.map(f => f.name)
      }
    );

    return NextResponse.json({ 
      success: true, 
      message: `Successfully synced and synthesized ${supportedFiles.length} files.`,
      project: { ...project, ...updates }
    });

  } catch (error: any) {
    console.error("Error in sync API route:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || "An error occurred during synchronization" 
    }, { status: 500 });
  }
}
