// Firebase config — fill these in from your Firebase project settings.
// (Web app config. The apiKey here is NOT a secret; security comes from
//  Firestore rules + Auth + the server-side Cloudinary signing function.)
export const firebaseConfig = {
  apiKey: "AIzaSyAI6OYOLE5u9XwF0DG6pk18H1fSvjsb6k4",
  authDomain: "vault-6af75.firebaseapp.com",
  projectId: "vault-6af75",
  storageBucket: "vault-6af75.firebasestorage.app",
  messagingSenderId: "169701420644",
  appId: "1:169701420644:web:494bb0a84e0808ff257971",
};

// Cloudinary cloud name (public — safe to expose).
export const CLOUDINARY_CLOUD_NAME = "lyrojt2v";

// Optional: lock the vault to a single Google account.
// Leave as "" to allow any signed-in Google user.
export const ALLOWED_EMAIL = "sergej.dzigajev@gmail.com";
