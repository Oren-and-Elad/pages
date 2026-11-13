/* Yael's assistant: an inline chat section, written answers only (no AI, nothing stored or sent).
   Answers live in T.kb below: [keywords..., answer]. Edit freely. */
(function(){
var he=document.documentElement.lang==='he';
var WA='https://wa.me/972525424127';
var HE={
 kicker:'חדש · העוזרת החכמה של יעל',h:'שאלו אותי כל דבר, עכשיו.',sub:'אני העוזרת של יעל, ואשמח לענות על מה שמעניין אתכם לפני שפונים אליה.',
 name:'העוזרת של יעל',status:'מחוברת · עונה מיד',note:'עוזרת אוטומטית · השאלות נשמרות בלי פרטים מזהים, כדי לשפר את התשובות',
 ph:'כתבו כאן את השאלה שלכם…',send:'שליחה',
 hello:['היי, נעים מאוד 😊','אני העוזרת של יעל. אפשר לשאול אותי כל דבר על הטיפול: למי זה מתאים, איך זה עובד אונליין, איך מתחילים…','מה תרצו לדעת?'],
 chips:['למי זה מתאים?','טיפול אונליין','איך מתחילים?','כמה זה עולה?'],
 more:'עוד משהו שתרצו לדעת?',
 miss:['שאלה טובה, ואני רוצה שתקבלו עליה תשובה מדויקת.','הכי נכון שיעל תענה עליה בעצמה. אפשר לשלוח לה את השאלה בוואטסאפ, והיא חוזרת אישית.'],
 waBtn:'לשלוח את השאלה ליעל בוואטסאפ',waPre:'היי יעל, הגעתי מהאתר. רציתי לשאול: ',
 thanks:'בשמחה 🌿 אם תרצו, יעל זמינה בוואטסאפ, ואפשר להתחיל בהודעה קצרה.',
 kb:[
  [['תודה','מעולה','סבבה'],'__thanks'],
  [['שלום','היי','הי ','בוקר','ערב'],'היי 😊 שמחה שבאתם. על מה תרצו לשאול?'],
  [['כמה עולה','כמה זה עולה','מחיר','עולה','עלות','כסף','תשלום','תעריף','החזר','ביטוח'],'על המחיר יעל מדברת ישירות עם כל אחד, יחד עם תיאום השעות. הכי פשוט לשלוח לה הודעה קצרה בוואטסאפ, והיא תחזור אליכם אישית.'],
  [['אונליין','זום','מרחוק','וידאו','חו"ל','חול','בחוץ לארץ','ארה"ב','ישראל'],'כן, הרבה מהמטופלים של יעל נפגשים איתה אונליין, מכל מקום בעולם. מאז הקורונה היא פיתחה דרכים לעבוד מרחוק בצורה חמה ומעשית, למשל משחק מרחוק וציור משותף על המסך.'],
  [['איפה','קליניקה','סידני','כתובת','פרונטלי','פנים'],'יעל מקבלת בקליניקה בסידני, ואפשר גם אונליין. מה שנוח לכם.'],
  [['שפה','עברית','אנגלית','english'],'בעברית ובאנגלית, מה שנוח לכם.'],
  [['ילד','ילדה','ילדים','בן ','בת ','נער','מתבגר','נוער','גיל'],'יעל עובדת עם ילדים ומתבגרים כבר יותר מעשרים שנה. הטיפול משלב שיחה, משחק ויצירה לפי הגיל, וההורים שותפים לפי הצורך.'],
  [['הורים','הדרכת','הורות'],'כן, יעל עושה גם הדרכת הורים: להבין מה עובר על הילד, לחזק את הקשר ולמצוא דרכי התמודדות שמתאימות למשפחה.'],
  [['עברנו לסידני','עברנו לאוסטרליה','עברנו','עברתי','רילוקיישן','מעבר','הגירה','עלייה','חזרה','געגוע','שייכות','אוסטרליה'],'זה תחום שקרוב ללב של יעל. היא ישראלית שחיה בסידני ומכירה את זה גם מבפנים: הגעגוע, הבדידות, וזה שכל אחד במשפחה מסתגל בקצב שלו. בטיפול יש לזה מקום.'],
  [['חרדה','פחד','פחדים','לחץ','פאניקה','דאגה','דאגנות'],'כן, יעל עובדת הרבה עם חרדה ופחדים: דאגנות, חרדה חברתית, פחדים והתקפי חרדה, אצל ילדים, מתבגרים ומבוגרים.'],
  [['דיכאון','עצב','מצב רוח','אין כוח','ירוד'],'כן. בטיפול יש מקום לדבר על הקושי, להבין אותו ולמצוא צעדים קטנים שעוזרים לחזור לחיים.'],
  [['טראומה','פוסט','חייל','מילואים','מלחמה','אירוע קשה','emdr'],'יעל מטפלת בטראומה ובחוויות קשות, כולל חיילים ונפגעי "חרבות ברזל". היא עובדת עם EMDR ו־CBT, בקצב ובמוכנות של כל אחד.'],
  [['שיטה','שיטות','cbt','גישה','איך עובד','איך זה עובד','ציור','אומנות','תנועה','vr'],'יעל משלבת כלים מכמה גישות, ובהן CBT ו־EMDR, וגם ציור, סיפור ותנועה. היא בוחרת יחד איתכם את מה שמתאים לכם.'],
  [['כמה זמן','כמה מפגשים','משך','אורך','תדירות','שבועי'],'זה שונה מאדם לאדם. המטרות נקבעות יחד, ובודקים לאורך הדרך מה עוזר. יעל תשמח לדבר על זה בפנייה הראשונה.'],
  [['להתחיל','מתחילים','לקבוע','פגישה','תור','זמינות','פנוי','שעות'],'מספיקה הודעה אחת 😊 כתבו ליעל בקצרה מה מביא אתכם, והיא תחזור אליכם אישית כדי לבדוק יחד אם זה מתאים. שעות המפגשים נקבעות איתה.'],
  [['מי','ניסיון','הכשרה','תואר','יעל'],'יעל קריו היא פסיכותרפיסטית עם הכשרה ב־CBT, הכשרה ב־EMDR (שלב 2) ותואר שני בטיפול באומנויות. יש לה יותר מעשרים שנות ניסיון בישראל ובאוסטרליה.'],
  [['מתאים','למי'],'הטיפול מתאים לילדים, למתבגרים ולמבוגרים, וגם להורים. בין התחומים: רילוקיישן, חרדה, דיכאון, טראומה והדרכת הורים. לא בטוחים? אפשר לשאול אותי על המצב שלכם.']
 ]},EN={
 kicker:'New · Yael\'s smart assistant',h:'Ask me anything, right now.',sub:'I\'m Yael\'s assistant, and I\'m happy to answer whatever you\'d like to know before you get in touch with her.',
 name:'Yael\'s assistant',status:'Online · replies straight away',note:'Automated assistant · questions are kept without personal details, to improve the answers',
 ph:'Type your question here…',send:'Send',
 hello:['Hi, nice to meet you 😊','I\'m Yael\'s assistant. Ask me anything about therapy with Yael: who it\'s for, how online sessions work, how to start…','What would you like to know?'],
 chips:['Who is it for?','Online therapy','How do I start?','How much does it cost?'],
 more:'Anything else you\'d like to know?',
 miss:['Good question, and I\'d like you to get an accurate answer.','It\'s best answered by Yael herself. You can send it to her on WhatsApp and she\'ll reply personally.'],
 waBtn:'Send my question to Yael on WhatsApp',waPre:'Hi Yael, I found you on your website. I wanted to ask: ',
 thanks:'My pleasure 🌿 Whenever you\'re ready, Yael is on WhatsApp, and a short message is all it takes.',
 kb:[
  [['thank','thanks','great','cheers'],'__thanks'],
  [['hello','hi ','hey'],'Hi 😊 Glad you\'re here. What would you like to ask?'],
  [['cost','price','fee','pay','rebate','medicare','insurance','how much'],'Yael talks about fees directly with each person, together with finding a time. The easiest way is a short WhatsApp message, and she\'ll get back to you personally.'],
  [['online','zoom','video','remote','overseas','abroad','israel','usa'],'Yes, many of Yael\'s clients meet her online, from anywhere in the world. Since COVID she\'s developed warm, hands-on ways of working remotely, like remote play and drawing together on screen.'],
  [['where are','where do','sessions held','held','location','where','clinic','sydney','address','in person','face'],'Yael sees people in her Sydney clinic, and online too. Whatever suits you.'],
  [['language','hebrew','english'],'English and Hebrew, whichever you\'re more comfortable in.'],
  [['child','kid','son','daughter','teen','adolescent','age'],'Yael has worked with children and teens for more than twenty years. Therapy combines talking, play and creativity to suit their age, with parents involved as needed.'],
  [['parent','parenting'],'Yes, Yael also offers parent guidance: understanding what your child is going through, strengthening your bond, and finding ways of coping that fit your family.'],
  [['reloc','move','moving','migrat','homesick','belong','new country','australia'],'This one is close to Yael\'s heart. She\'s an Israeli living in Sydney and knows it from the inside: the homesickness, the loneliness, and each family member adjusting at their own pace. There\'s room for all of it in therapy.'],
  [['anxi','fear','panic','worry','stress','nervous'],'Yes, Yael works a lot with anxiety and fears: worry, social anxiety, fears and panic attacks, in children, teens and adults.'],
  [['depress','sad','low','mood','motivation'],'Yes. Therapy is a place to talk about what\'s hard, understand it, and find small steps back into life.'],
  [['trauma','ptsd','soldier','war','emdr','difficult experience'],'Yael works with trauma and difficult experiences, including soldiers affected by the Swords of Iron war. She uses EMDR and CBT, at each person\'s own pace and readiness.'],
  [['method','cbt','approach','how does it work','art','draw','movement','vr'],'Yael combines tools from several approaches, including CBT and EMDR, as well as drawing, story and movement. She chooses together with you what fits.'],
  [['how long','how many sessions','how many','weekly','duration'],'It differs from person to person. You set goals together and check along the way what helps. Yael is happy to talk about it when you first get in touch.'],
  [['start','book','appointment','available','availability','times'],'One message is enough 😊 Write Yael a few words about what brings you, and she\'ll get back to you personally so you can see together if it\'s a good fit. Session times are arranged with her.'],
  [['who','experience','qualif','degree','yael'],'Yael Kario is a psychotherapist trained in CBT and EMDR (Level 2), with a Master\'s in arts therapy. She has more than twenty years of experience in Israel and Australia.'],
  [['for me','suit','right for','who is'],'Therapy with Yael is for children, teens, adults and parents. Areas include relocation, anxiety, depression, trauma and parent guidance. Not sure? Tell me a little about your situation.']
 ]};
var T=he?HE:EN;
var css='.ya{padding:70px 0;background:linear-gradient(135deg,#3c5338,#4f6b4a);color:#fff}.ya h2,.ya .kicker{color:#fff}.ya p{color:#e8efe4}.ya .rule{background:#d9a99a}.ya .wrap{display:grid;grid-template-columns:.85fr 1.15fr;gap:60px;align-items:center}'+
'.ya h2{font-size:clamp(34px,4vw,52px)}.ya-c{background:#fff;border-radius:22px;box-shadow:0 20px 50px rgba(60,83,56,.12);display:flex;flex-direction:column;height:520px;overflow:hidden}'+
'.ya-h{display:flex;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(46,51,44,.1)}.ya-h img{width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:top}.ya-h b{display:block;font-weight:600;font-size:16px}.ya-h small{color:#4f6b4a;font-size:13px}.ya-h small:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#5cb85c;margin:0 6px}'+
'.ya-m{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#f7f3ec}.ya-x{max-width:85%;padding:10px 14px;border-radius:16px;background:#fff;font-size:16px;line-height:1.5;box-shadow:0 1px 2px rgba(0,0,0,.05);animation:yaIn .25s ease}'+
'.ya-u{align-self:flex-end;background:#dfe9d8}.ya-t{display:flex;gap:4px;padding:14px}.ya-t i{width:7px;height:7px;border-radius:50%;background:#9aa395;animation:yaB 1s infinite}.ya-t i:nth-child(2){animation-delay:.15s}.ya-t i:nth-child(3){animation-delay:.3s}'+
'.ya-ch{display:flex;flex-wrap:wrap;gap:6px}.ya-ch button{background:#fff;border:1px solid #4f6b4a;color:#3c5338;border-radius:20px;padding:7px 13px;font:400 14.5px Assistant,sans-serif;cursor:pointer}'+
'.ya-w{display:inline-block;background:#3f7a4f;color:#fff;text-decoration:none;border-radius:20px;padding:9px 15px;font-weight:600;font-size:15px}'+
'.ya-f{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(46,51,44,.1)}.ya-f input{flex:1;font:300 16px Assistant,sans-serif;padding:12px 14px;border:1px solid rgba(46,51,44,.15);border-radius:24px;background:#f7f3ec}.ya-f button{background:#4f6b4a;color:#fff;border:0;border-radius:24px;padding:0 18px;font:400 15px Assistant,sans-serif;cursor:pointer}'+
'.ya-n{font-size:12px;color:#7a7f75;text-align:center;padding:0 0 8px}'+
'.ya-hero{height:400px;margin:10px 0 6px;max-width:560px}.ya-lab{display:flex;align-items:center;gap:8px;margin-top:14px;font-weight:600;color:#3c5338;font-size:15px}.ya-lab span{background:linear-gradient(135deg,#4f6b4a,#d9a99a);color:#fff;border-radius:6px;padding:2px 7px;font-size:12px;letter-spacing:.08em}.hero .copy{padding-top:5vh!important;padding-bottom:5vh!important}.hero h1{font-size:clamp(40px,5vw,66px)!important}'+
'@keyframes yaIn{from{opacity:0;transform:translateY(6px)}}@keyframes yaB{50%{transform:translateY(-4px);opacity:.5}}'+
'@media(max-width:900px){.ya .wrap{grid-template-columns:1fr;gap:28px}.ya-c{height:500px}}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
var img=(document.querySelector('.about img')||{}).getAttribute?document.querySelector('.about img').getAttribute('src'):'';
var sec=document.createElement('section');sec.className='ya';sec.id='ask';
sec.innerHTML='<div class="wrap"><div><div class="kicker">'+T.kicker+'</div><div class="rule"></div><h2>'+T.h+'</h2><p>'+T.sub+'</p></div>'+
'<div class="ya-c"><div class="ya-h">'+(img?'<img src="'+img+'" alt="">':'')+'<div><b>'+T.name+'</b><small>'+T.status+'</small></div></div>'+
'<div class="ya-m" aria-live="polite"></div><form class="ya-f"><input aria-label="'+T.ph+'" placeholder="'+T.ph+'" autocomplete="off"><button>'+T.send+'</button></form><div class="ya-n">'+T.note+'</div></div></div>';
var hero=document.querySelector('header.hero .copy');
var card=sec.querySelector('.ya-c');card.classList.add('ya-hero');card.id='ask';
var lab=document.createElement('div');lab.className='ya-lab';lab.innerHTML='<span>AI</span>'+T.kicker;
var ps=hero.querySelectorAll('p');for(var i=1;i<ps.length;i++)ps[i].style.display='none';var pr=hero.querySelector('.promise');if(pr)pr.style.display='none';
var ctas=hero.querySelector('.ctas');hero.insertBefore(lab,ctas);hero.insertBefore(card,ctas);
sec=card;
var m=sec.querySelector('.ya-m'),f=sec.querySelector('form'),inp=f.querySelector('input');
function ev(n,p){try{p=p||{};p.page_lang=document.documentElement.lang;gtag('event',n,p)}catch(e){}}
function add(el){m.appendChild(el);m.scrollTop=m.scrollHeight}
function bub(t,u){var d=document.createElement('div');d.className='ya-x'+(u?' ya-u':'');d.textContent=t;add(d)}
var q=Promise.resolve();
function bot(t,extra){q=q.then(function(){var ty=document.createElement('div');ty.className='ya-x ya-t';ty.innerHTML='<i></i><i></i><i></i>';add(ty);
 return new Promise(function(r){setTimeout(function(){ty.remove();if(t)bub(t);if(extra)add(extra());r()},Math.min(1600,500+t.length*14))})})}
function chips(list){bot('',function(){var c=document.createElement('div');c.className='ya-ch';list.forEach(function(x){var b=document.createElement('button');b.type='button';b.textContent=x;b.onclick=function(){c.remove();ask(x)};c.appendChild(b)});return c})}
function waLink(txt,L){L=L||T;return function(){var a=document.createElement('a');a.className='ya-w';a.target='_blank';a.rel='noopener';a.dataset.wa='assistant';a.href=WA+'?text='+encodeURIComponent(L.waPre+(txt||''));a.textContent='💬 '+L.waBtn;a.onclick=function(){ev('whatsapp_click',{button:'assistant'})};return a}}
function norm(s){return ' '+s.toLowerCase().replace(/[?!.,״"׳']/g,' ')+' '}
function answer(s,L){var n=norm(s),best=null,score=0;L.kb.forEach(function(e){var k=e[0],sc=0;k.forEach(function(w){if(n.indexOf(w.toLowerCase())>-1)sc+=w.length});if(sc>score){score=sc;best=e[1]}});return best}
function clean(t){return t.replace(/\S+@\S+/g,'[email]').replace(/\+?\d[\d\s-]{6,}\d/g,'[phone]').slice(0,100)}
var asked=0;
function ask(s){s=s.trim();if(!s)return;bub(s,1);asked++;var L=/[\u0590-\u05FF]/.test(s)?HE:/[a-z]/i.test(s)?EN:T;var a=answer(s,L);ev('assistant_question',{matched:a?'yes':'no',question:clean(s)});
 if(a==='__thanks'){bot(L.thanks,waLink('',L));return}
 if(!a){bot(L.miss[0]);bot(L.miss[1],waLink(s,L));return}
 bot(a);if(asked%2===0)bot(L.more,waLink('',L));else bot(L.more)}
f.onsubmit=function(e){e.preventDefault();m.querySelectorAll('.ya-ch').forEach(function(c){c.remove()});var v=inp.value;inp.value='';ask(v)};
var started=0;function start(){if(started)return;started=1;T.hello.forEach(function(h){bot(h)});chips(T.chips);ev('assistant_view')}
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){if(es[0].isIntersecting){start();io.disconnect()}},{threshold:.05});io.observe(sec)}else start();
var nav=document.querySelector('.links');if(nav){var l=document.createElement('a');l.href='#ask';l.textContent=he?'שאלות':'Questions';nav.insertBefore(l,nav.lastElementChild)}
})();
