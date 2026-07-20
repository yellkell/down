/**
 * "X WAS HERE" — the finish-zone graffiti wall, backed by Firestore.
 *
 * There's no score and no leaderboard in DOWN; instead, everyone who
 * survives the descent gets to tag the bottom of the world. This module is
 * the thin data layer: fetch the most recent marks, append one.
 *
 * Uses the Firestore *Lite* SDK — plain REST, no realtime socket — which
 * keeps the bundle small and works fine inside a WebXR session.
 */
import { initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp
} from 'firebase/firestore/lite';

const firebaseConfig = {
  apiKey: 'AIzaSyBS-yMrhzf8f4LmJeOl0tcbFelQEt3VrOY',
  authDomain: 'yellcoin-84ea5.firebaseapp.com',
  projectId: 'yellcoin-84ea5',
  storageBucket: 'yellcoin-84ea5.firebasestorage.app',
  messagingSenderId: '397925677229',
  appId: '1:397925677229:web:af879a7365a367a0ef6e24'
};

/** Max marks pulled down and painted into the finish zone. */
export const MAX_MARKS = 200;
/** Name rules — must match firestore.rules exactly. */
export const NAME_MAX = 10;
const NAME_RE = /^[A-Z0-9 ]{1,10}$/;

const db = getFirestore(initializeApp(firebaseConfig));
const marks = collection(db, 'marks');

/**
 * Latest marks, newest first. Resolves to [] on any failure — the wall
 * simply starts empty if the network is down; the game never blocks on it.
 */
export async function fetchMarks(): Promise<string[]> {
  try {
    const snap = await getDocs(query(marks, orderBy('t', 'desc'), limit(MAX_MARKS)));
    return snap.docs
      .map((d) => String(d.get('name') ?? ''))
      .filter((n) => NAME_RE.test(n));
  } catch {
    return [];
  }
}

/** Leave a mark. Fire-and-forget safe; resolves false if rejected/offline. */
export async function submitMark(name: string): Promise<boolean> {
  const clean = name.trim().toUpperCase().slice(0, NAME_MAX);
  if (!NAME_RE.test(clean)) return false;
  try {
    await addDoc(marks, { name: clean, t: serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}
