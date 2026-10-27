const U = { email: 'oren001@gmail.com', uid: 'u-oren', displayName: 'Oren', photoURL: '' };
export const getAuth = () => ({ currentUser: U, onAuthStateChanged: (cb) => { setTimeout(() => cb(U), 0); return () => {}; } });
export class GoogleAuthProvider { setCustomParameters() {} addScope() {} }
export const signInWithPopup = async () => ({ user: U });
export const signInWithRedirect = async () => {};
export const getRedirectResult = async () => null;
export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(U), 0); return () => {}; };
export const signOut = async () => {};
export const setPersistence = async () => {};
export const browserLocalPersistence = {};
export default {};
