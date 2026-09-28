// Firebase SDK (CDN). 버전을 올릴 때는 세 줄의 버전 번호를 함께 바꾼다.
export { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
export {
    getAuth, connectAuthEmulator, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
    sendEmailVerification, sendPasswordResetEmail,
    updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
export {
    getFirestore, connectFirestoreEmulator,
    collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, where, orderBy, limit, writeBatch, increment, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
