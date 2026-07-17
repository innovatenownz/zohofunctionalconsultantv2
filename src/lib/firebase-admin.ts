import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export function getAdminDb() {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
      console.warn("Firebase Admin credentials not found. Ensure they are in .env.local");
      return null;
    }
    
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Handle newline characters in the private key string correctly
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } catch (error) {
      console.error('Firebase admin initialization error', error);
      return null;
    }
  }
  return getFirestore(admin.app(), 'zhfnctl03');
}
