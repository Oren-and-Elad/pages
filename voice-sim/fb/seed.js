// The simulator's starting state: invented rooms and threads. Nothing here is real.
import { write, Timestamp } from './store.js';
const now = Date.now();
export const at = (minAgo) => { const ms = now - minAgo * 60000; return { createdAt: Timestamp.fromMillis(ms), ts: ms }; };
const R = (id, d) => write(`elad-oren-rooms/${id}`, d);
R('hq2', { name: 'Boss', pinned: true });
R('site', { name: 'האתר שלנו', pinned: true });
R('ops', { name: 'תפעול', pinned: true });
const M = (room, id, d, minAgo) => write(`elad-oren-rooms/${room}/messages/${id}`, { ...d, ...at(minAgo) });
M('hq2', 'cards', { from: 'Oren', title: 'סדר בכרטיסים', text: 'יש יותר מדי כרטיסים ביום. תציעי איך לצמצם אותם לארבעה סוגים.', goal: { state: 'done' } }, 260);
M('hq2', 'cardsr', { from: 'brain', text: 'הצעתי ארבעה סוגים: אישור, שאלה, עדכון ותקלה. מחכה לאישור שלך.', threadId: 'cards' }, 255);
M('hq2', 'backup', { from: 'Elad', title: 'גיבוי לילי', text: 'תוודאי שהגיבוי של הלילה רץ ושאפשר לשחזר ממנו.', goal: { state: 'working' } }, 70);
M('hq2', 'backupr', { from: 'brain', text: 'הגיבוי רץ ב־02:00. בודקת עכשיו שחזור של קובץ אחד ומדווחת כאן.', threadId: 'backup' }, 68);
M('hq2', 'week', { from: 'Oren', title: 'סיכום השבוע', text: 'תכיני לי סיכום קצר של מה שנסגר השבוע ומה עדיין פתוח.', goal: { state: 'working' } }, 25);
M('hq2', 'weekr', { from: 'brain', text: 'אוספת. יהיה מוכן בעוד כמה דקות.', threadId: 'week' }, 24);
M('site', 'form', { from: 'Oren', title: 'טופס יצירת קשר', text: 'הטופס באתר לא שומר את מספר הטלפון. תתקני.', goal: { state: 'working' } }, 40);
M('site', 'formr', { from: 'brain', text: 'מצאתי את הבעיה, מתקנת.', threadId: 'form' }, 38);
M('ops', 'inv', { from: 'Elad', title: 'רשימת ספקים', text: 'תשלחי לי את רשימת הספקים המעודכנת.', goal: { state: 'done' } }, 200);
M('ops', 'invr', { from: 'brain', text: 'הרשימה אצלך.', threadId: 'inv' }, 190);
