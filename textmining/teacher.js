// ことばレンズ 教員画面：問いの作成・受付の切り替え・回答のリアルタイム集計
import { firebaseConfig, SDK, emulators } from './firebase-config.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gate = (msg, signIn = false) => {
  $('#gateMsg').textContent = msg; $('#signIn').hidden = !signIn;
  $('#gate').hidden = false; $('#app').hidden = true;
};
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch (_) {} },
};

KotobaLens.init({defaultTab: 'cloud', emptyMessage: 'まだ回答がありません。子どもに配るURLを開いてもらいましょう。'});
KotobaLens.setText('');

if (!firebaseConfig.projectId) {
  gate('firebase-config.js がまだ設定されていません。README.md の「教員向け：はじめの設定」に沿って Firebase の値を貼り付けてください。');
} else {
  start().catch(err => { console.error(err); gate('Firebase を読み込めませんでした。通信状態を確かめて、ページを開き直してください。'); });
}

async function start(){
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-firestore.js`), import(`${SDK}/firebase-auth.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  if (emulators) {
    fs.connectFirestoreEmulator(db, emulators.host, emulators.firestore);
    au.connectAuthEmulator(auth, `http://${emulators.host}:${emulators.auth}`, {disableWarnings: true});
  }

  $('#signIn').addEventListener('click', () => au.signInWithPopup(auth, new au.GoogleAuthProvider())
    .catch(err => { if (err.code !== 'auth/popup-closed-by-user') gate(`ログインできませんでした（${err.code}）。Firebase の Authentication で Google ログインと承認済みドメインを確認してください。`, true); }));
  $('#signOut').addEventListener('click', () => au.signOut(auth));
  $('#present').addEventListener('click', () => {
    const on = document.body.classList.toggle('present');
    $('#present').textContent = on ? '管理画面に戻る' : '大きく表示';
    KotobaLens.renderActive();
  });

  let questions = [], current = null, unsubQ = null, unsubR = null;

  au.onAuthStateChanged(auth, user => {
    unsubQ?.(); unsubR?.(); unsubQ = unsubR = null;
    if (!user) { $('#who').hidden = true; gate('問いの作成と回答の確認には、教員の Google アカウントでログインしてください。', true); return; }
    $('#whoName').textContent = user.email;
    $('#who').hidden = false; $('#gate').hidden = true; $('#app').hidden = false;
    KotobaLens.renderActive();
    unsubQ = fs.onSnapshot(fs.query(fs.collection(db, 'questions'), fs.where('ownerUid', '==', user.uid)), snap => {
      questions = snap.docs.map(d => ({id: d.id, ...d.data()}))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? Infinity) - (a.createdAt?.toMillis?.() ?? Infinity));
      renderQuestions();
    }, err => {
      if (err.code === 'permission-denied') gate(`${user.email} は教員として登録されていません。firestore.rules の教員メールアドレスの一覧にこのアドレスを追加して、ルールを公開し直してください。`);
      else gate(`問いを読み込めませんでした（${err.code}）。`);
      $('#who').hidden = false;
    });
  });

  function renderQuestions(){
    const sel = $('#qSelect');
    if (!questions.length) {
      sel.innerHTML = '<option value="">まだ問いがありません。上の欄から作ってください</option>';
      selectQuestion(null); return;
    }
    const want = current?.id ?? store.get('kl.q');
    const id = questions.some(q => q.id === want) ? want : questions[0].id;
    sel.innerHTML = questions.map(q => `<option value="${q.id}">${q.open ? '● ' : '○ '}${esc(q.title)}</option>`).join('');
    sel.value = id;
    selectQuestion(questions.find(q => q.id === id));
  }

  function selectQuestion(q){
    const changed = q?.id !== current?.id;
    current = q;
    $('#qHead').hidden = $('#respPanel').hidden = !q;
    if (!q) { unsubR?.(); unsubR = null; KotobaLens.setText(''); $('#presentTitle').textContent = ''; return; }
    store.set('kl.q', q.id);
    $('#qTitleView').textContent = q.title;
    $('#presentTitle').textContent = q.title;
    $('#qStatus').className = 'status ' + (q.open ? 'open' : 'closed');
    $('#qStatus').innerHTML = `<i></i>${q.open ? '受付中' : '締め切り'}`;
    $('#qToggle').textContent = q.open ? '締め切る' : '受付を再開';
    const url = new URL(`student.html?q=${encodeURIComponent(q.id)}`, location.href).href;
    $('#qUrl').value = url;
    if (window.qrcode) {
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      $('#qQr').innerHTML = qr.createSvgTag({cellSize: 4, margin: 2, scalable: true});
    }
    if (!changed) return;
    unsubR?.();
    $('#respList').innerHTML = ''; $('#respCount').textContent = '';
    unsubR = fs.onSnapshot(fs.query(fs.collection(db, 'questions', q.id, 'responses'), fs.orderBy('createdAt')), snap => {
      const rs = snap.docs.map(d => ({id: d.id, ...d.data()}));
      renderResponses(rs);
      // 1回答を1行にして解析エンジンへ渡す
      KotobaLens.setText(rs.map(r => r.text.replace(/\s*\n+\s*/g, ' ')).join('\n'));
    }, err => KotobaLens.toast(`回答を読み込めませんでした（${err.code}）`));
  }

  function renderResponses(rs){
    $('#respCount').textContent = `${rs.length} 件`;
    const fmt = t => t?.toDate ? t.toDate().toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : '';
    $('#respList').innerHTML = rs.length
      ? rs.slice().reverse().map(r => `<li><time>${fmt(r.createdAt)}</time><p>${esc(r.text)}</p><button type="button" data-del="${r.id}" aria-label="この回答を消す">消す</button></li>`).join('')
      : '<li><span></span><p class="note">まだ回答がありません。</p><span></span></li>';
  }

  $('#qSelect').addEventListener('change', e => selectQuestion(questions.find(q => q.id === e.target.value) ?? null));

  $('#qNewForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#qNew').value.trim();
    if (!title) return;
    try {
      const ref = await fs.addDoc(fs.collection(db, 'questions'), {
        ownerUid: auth.currentUser.uid, title, open: true, createdAt: fs.serverTimestamp(),
      });
      $('#qNew').value = '';
      store.set('kl.q', ref.id); current = null;
      renderQuestions();
      KotobaLens.toast('問いを作りました。URLかQRコードを子どもに配ってください');
    } catch (err) { KotobaLens.toast(`問いを作れませんでした（${err.code}）`); }
  });

  $('#qToggle').addEventListener('click', async () => {
    if (!current) return;
    try { await fs.updateDoc(fs.doc(db, 'questions', current.id), {open: !current.open}); }
    catch (err) { KotobaLens.toast(`切り替えられませんでした（${err.code}）`); }
  });

  $('#qDelete').addEventListener('click', async () => {
    if (!current || !confirm(`「${current.title}」と、その回答をすべて削除します。元に戻せません。よろしいですか？`)) return;
    const id = current.id;
    try {
      unsubR?.(); unsubR = null; current = null;
      const rs = await fs.getDocs(fs.collection(db, 'questions', id, 'responses'));
      await Promise.all(rs.docs.map(d => fs.deleteDoc(d.ref)));
      await fs.deleteDoc(fs.doc(db, 'questions', id));
      KotobaLens.toast('削除しました');
    } catch (err) { KotobaLens.toast(`削除できませんでした（${err.code}）`); }
  });

  $('#respList').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]');
    if (!b || !current) return;
    try { await fs.deleteDoc(fs.doc(db, 'questions', current.id, 'responses', b.dataset.del)); }
    catch (err) { KotobaLens.toast(`消せませんでした（${err.code}）`); }
  });

  $('#qCopy').addEventListener('click', () => {
    const inp = $('#qUrl');
    navigator.clipboard.writeText(inp.value).then(() => KotobaLens.toast('URLをコピーしました'), () => { inp.focus(); inp.select(); });
  });
}
