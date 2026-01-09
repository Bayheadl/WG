// firebase.js — Browser CDN (10.12.4)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFsb7EG9-ostWGNV3BvfL-DlCpZVVYLj0",
  authDomain: "wk-game.firebaseapp.com",
  projectId: "wk-game",
  storageBucket: "wk-game.firebasestorage.app",
  messagingSenderId: "178083838414",
  appId: "1:178083838414:web:20e36975cf87216c39539f",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const auth = getAuth(app);

export async function ensureAnonAuth() {
  const cred = await signInAnonymously(auth);
  return cred.user; // فيه uid
}

export { serverTimestamp };