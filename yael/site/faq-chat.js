/* FAQ chat: pre-written questions and answers only (no AI, nothing sent anywhere). Edit the Q&A below. */
(function(){
var he=document.documentElement.lang==='he';
var WA='https://wa.me/972525424127';
var T=he?{
 title:'שאלות נפוצות',hi:'שלום 👋 אפשר לבחור שאלה, ואם לא מצאתם תשובה — כתבו ליעל ישירות.',open:'יש שאלה?',wa:'לכתוב ליעל בוואטסאפ',back:'שאלות נוספות',
 qa:[
  ['למי מתאים הטיפול?','לילדים, למתבגרים ולמבוגרים, וגם להדרכת הורים. בין התחומים: רילוקיישן ומעברים בחיים, חרדה ופחדים, דיכאון ומצב רוח ירוד, וטראומה וחוויות קשות.'],
  ['איפה מתקיימים המפגשים?','בקליניקה בסידני או אונליין, כך שאפשר להיפגש מכל מקום בעולם.'],
  ['באיזו שפה?','בעברית ובאנגלית.'],
  ['איך עובד טיפול אונליין?','מפגש בווידאו. מאז הקורונה יעל פיתחה דרכים לעבוד מרחוק בצורה חמה ומעשית, למשל משחק מרחוק וציור משותף אונליין.'],
  ['באילו שיטות יעל עובדת?','יעל משלבת כלים מגישות שונות, ובהם CBT ו־EMDR, וגם ציור, סיפור ותנועה — בהתאם לצרכים ולמטרות שמגדירים יחד.'],
  ['איך נראה התהליך?','1. מכירים ומבינים מה מעסיק אתכם. 2. מגדירים יחד מטרות ודרכי עבודה. 3. מתנסים, בודקים מה עוזר ומתאימים את ההמשך.'],
  ['כמה זמן נמשך טיפול?','זה משתנה מאדם לאדם, ונקבע יחד לפי המטרות שלכם. כדאי לשאול את יעל ישירות.'],
  ['כמה זה עולה?','על המחיר ועל שעות המפגשים מדברים ישירות עם יעל. אפשר לכתוב לה בוואטסאפ.'],
  ['איך מתחילים?','מספיקה הודעה אחת. כתבו ליעל בקצרה מה מביא אתכם, והיא תחזור אליכם אישית.']
 ]}:{
 title:'Common questions',hi:'Hi 👋 Pick a question. If yours isn\'t here, message Yael directly.',open:'Questions?',wa:'Message Yael on WhatsApp',back:'More questions',
 qa:[
  ['Who is therapy for?','Children, teens and adults, and guidance for parents. Areas include relocation and life transitions, anxiety and fears, depression and low mood, and trauma and difficult experiences.'],
  ['Where are sessions held?','In my Sydney clinic or online, so you can join from anywhere.'],
  ['Which languages?','English and Hebrew.'],
  ['How does online therapy work?','A video session. Since the COVID years Yael has developed warm, hands-on ways of working online, such as remote play and drawing together.'],
  ['Which methods does Yael use?','Tools from different approaches, including CBT and EMDR, as well as drawing, story and movement, according to the goals you set together.'],
  ['What does the process look like?','1. We get to know each other and what\'s on your mind. 2. We set goals and choose ways of working together. 3. We try things out, see what helps and adjust.'],
  ['How long does therapy take?','It varies from person to person and is shaped around your goals. Best to ask Yael directly.'],
  ['How much does it cost?','Fees and session times are arranged directly with Yael. You can message her on WhatsApp.'],
  ['How do I start?','One message is enough. Write Yael a few words about what brings you, and she\'ll get back to you personally.']
 ]};
var S=he?'right':'left';
var css='.fq-b{position:fixed;'+S+':20px;bottom:20px;z-index:31;background:#4f6b4a;color:#fff;border:0;border-radius:40px;padding:13px 20px;font:400 15px Assistant,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.18);cursor:pointer}'+
'.fq-p{position:fixed;'+S+':20px;bottom:80px;z-index:32;width:min(360px,calc(100vw - 40px));max-height:min(560px,calc(100vh - 110px));display:none;flex-direction:column;background:#fff;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.2);overflow:hidden;font:300 15.5px/1.55 Assistant,sans-serif;color:#2e332c}'+
'.fq-p.on{display:flex}.fq-h{background:#4f6b4a;color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;font-weight:600}.fq-h button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}'+
'.fq-m{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:8px;background:#f7f3ec;flex:1}.fq-x{background:#fff;border-radius:14px;padding:10px 13px;max-width:88%}.fq-u{align-self:flex-end;background:#d9e4d3}'+
'.fq-o{display:flex;flex-direction:column;gap:6px}.fq-o button{text-align:start;background:#fff;border:1px solid #4f6b4a;color:#3c5338;border-radius:12px;padding:8px 12px;font:400 14.5px Assistant,sans-serif;cursor:pointer}'+
'.fq-w{display:block;text-align:center;background:#3f7a4f;color:#fff;text-decoration:none;padding:11px;font-weight:600}'+
'@media(max-width:560px){.fq-b{bottom:76px}.fq-p{bottom:136px}}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
var b=document.createElement('button');b.className='fq-b';b.textContent='💬 '+T.open;b.setAttribute('aria-expanded','false');
var p=document.createElement('div');p.className='fq-p';p.setAttribute('role','dialog');p.setAttribute('aria-label',T.title);if(he)p.dir='rtl';
p.innerHTML='<div class="fq-h"><span>'+T.title+'</span><button aria-label="close">×</button></div><div class="fq-m"></div><a class="fq-w" data-wa="chat" href="'+WA+'" target="_blank" rel="noopener">'+T.wa+'</a>';
document.body.appendChild(p);document.body.appendChild(b);
var m=p.querySelector('.fq-m');
function say(t,u){var d=document.createElement('div');d.className='fq-x'+(u?' fq-u':'');d.textContent=t;m.appendChild(d);m.scrollTop=m.scrollHeight}
function menu(){var o=document.createElement('div');o.className='fq-o';T.qa.forEach(function(q,i){var x=document.createElement('button');x.textContent=q[0];x.onclick=function(){o.remove();say(q[0],1);say(q[1]);try{gtag('event','faq_question',{question:i,page_lang:document.documentElement.lang})}catch(e){}var a=document.createElement('div');a.className='fq-o';var bk=document.createElement('button');bk.textContent='↩ '+T.back;bk.onclick=function(){a.remove();menu()};a.appendChild(bk);m.appendChild(a);m.scrollTop=m.scrollHeight};o.appendChild(x)});m.appendChild(o);m.scrollTop=m.scrollHeight}
var started=0;
function tog(){var on=p.classList.toggle('on');b.setAttribute('aria-expanded',on);if(on&&!started){started=1;say(T.hi);menu();try{gtag('event','faq_open',{page_lang:document.documentElement.lang})}catch(e){}}}
b.onclick=tog;p.querySelector('.fq-h button').onclick=tog;
p.querySelector('.fq-w').addEventListener('click',function(){try{gtag('event','whatsapp_click',{button:'chat',page_lang:document.documentElement.lang})}catch(e){}});
})();
