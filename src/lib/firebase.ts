import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore as getClientFirestore } from "firebase/firestore";

// --- Client SDK Setup ---
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

// Initialize Firebase client
const app = firebaseConfig.projectId 
  ? (!getApps().length ? initializeApp(firebaseConfig) : getApp())
  : null;
export const db = app ? getClientFirestore(app, "zhfnctl03") : null;
