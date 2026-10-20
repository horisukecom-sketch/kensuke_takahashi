// Firebase コンソール →「プロジェクトの設定」→「マイアプリ（ウェブアプリ）」に表示される firebaseConfig の値を貼り付けてください。
// 手順は README.md の「教員向け：はじめの設定」を参照。
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// 読み込む Firebase SDK のバージョン（student.html / teacher.html 共通）
export const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// 動作確認用：Firebase エミュレーターにつなぐときだけ {host: '127.0.0.1', firestore: 8080, auth: 9099} にする。本番では null のまま
export const emulators = null;
