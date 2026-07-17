import { google } from 'googleapis';
import { getSession } from '@/lib/auth';

export async function getGoogleDriveService() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (privateKey && clientEmail) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return google.drive({ version: 'v3', auth });
  }

  const session = await getSession() as any;
  
  if (!session || !session.accessToken) {
    throw new Error('Not authenticated and no service account credentials found');
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ 
    access_token: session.accessToken,
    refresh_token: session.refreshToken
  });

  return google.drive({ version: 'v3', auth });
}


export async function listFolderFiles(folderId: string) {
  try {
    const drive = await getGoogleDriveService();
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, webViewLink)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error fetching Google Drive files:', error);
    throw error;
  }
}

export async function extractDocumentText(fileId: string, mimeType: string) {
  const drive = await getGoogleDriveService();

  try {
    // If it's a Google Doc, export to text
    if (mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/plain',
      });
      return response.data;
    }

    // If it's a Google Spreadsheet, export to CSV
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/csv',
      });
      return response.data;
    }
    
    // For other readable files, download the content directly
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'application/json' || mimeType === 'text/csv') {
      const response = await drive.files.get({
        fileId,
        alt: 'media',
      }, { responseType: 'text' });
      return response.data;
    }

    return `[File format ${mimeType} not supported for text extraction]`;
  } catch (error) {
    console.error(`Error reading file ${fileId}:`, error);
    throw error;
  }
}
