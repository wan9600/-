// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → "SDK 설정 및 구성"에 나오는 값을 붙여넣으세요.
// 이 값들은 공개되어도 괜찮은 식별자입니다. 데이터 보호는 firestore.rules 가 담당합니다.
export const firebaseConfig = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
};

// 가입을 허용할 학교 메일 도메인. 바꾸면 firestore.rules 의 schoolEmail() 도 같이 바꿔야 합니다.
export const SCHOOL_DOMAINS = {
    'korea.ac.kr': 'KU',
    'yonsei.ac.kr': 'YU',
};
