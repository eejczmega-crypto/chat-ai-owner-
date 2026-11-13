const $=s=>document.querySelector(s);
const form=$("#chatForm"), promptBox=$("#prompt"), chat=$("#chat"), welcome=$("#welcome");
let history=[], currentUser=null, signup=false;
function msg(role,content){const el=document.createElement("div");el.className=`message ${role}`;el.textContent=content;chat.appendChild(el);el.scrollIntoView({behavior:"smooth",block:"end"});return el;}
function updateUser(u){currentUser=u;$("#profileName").textContent=u?.name||"زائر Chat MeGa";$("#profileRole").textContent=u?.role==="owner"?"مالك الموقع":u?"عضو":"سجّل الدخول للبدء";$("#planName").textContent=u?.role==="owner"?"Lifetime مدى الحياة":u?.plan==="premium"?"Premium":"مجاني";$("#adminLink").hidden=u?.role!=="owner";$("#logoutBtn").hidden=!u;$("#authBtn").hidden=!!u;}
async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||"حدث خطأ");return d;}
async function refresh(){try{const d=await api("/api/me");updateUser(d.user);}catch{updateUser(null);}}
function openAuth(){signup=false;$("#authTitle").textContent="تسجيل الدخول";$("#authSubmit").textContent="دخول";$("#nameField").hidden=true;$("#authModal").classList.add("show");}
$("#authBtn").addEventListener("click",openAuth);$("#closeAuth").onclick=()=>$("#authModal").classList.remove("show");
$("#switchAuth").onclick=()=>{signup=!signup;$("#authTitle").textContent=signup?"إنشاء حساب جديد":"تسجيل الدخول";$("#authSubmit").textContent=signup?"إنشاء الحساب":"دخول";$("#nameField").hidden=!signup;$("#authPassword").autocomplete=signup?"new-password":"current-password";};
$("#authForm").onsubmit=async e=>{e.preventDefault();try{const d=await api(signup?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({name:$("#authName").value,email:$("#authEmail").value,password:$("#authPassword").value})});updateUser(d.user);$("#authModal").classList.remove("show");}catch(err){alert(err.message);}};
$("#logoutBtn").onclick=async()=>{try{await api("/api/logout",{method:"POST"});}finally{updateUser(null);history=[];chat.innerHTML="";}};
async function send(text){const value=(text||promptBox.value).trim();if(!value)return;if(!currentUser){openAuth();return;}welcome.style.display="none";promptBox.value="";history.push({role:"user",content:value});msg("user",value);$("#sendBtn").disabled=true;const loading=msg("assistant","جاري التفكير...");try{const d=await api("/api/chat",{method:"POST",body:JSON.stringify({messages:history})});loading.textContent=d.reply;history.push({role:"assistant",content:d.reply});}catch(e){loading.textContent=e.message;}finally{$("#sendBtn").disabled=false;promptBox.focus();}}
form.onsubmit=e=>{e.preventDefault();send();};document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>send(b.dataset.prompt));
$("#newChat").onclick=()=>{history=[];chat.innerHTML="";welcome.style.display="block";};$("#upgrade").onclick=()=>$("#upgradeModal").classList.add("show");$("#closeUpgrade").onclick=()=>$("#upgradeModal").classList.remove("show");
$("#themeBtn").onclick=()=>document.body.classList.toggle("light");$("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
document.querySelectorAll("[data-info]").forEach(b=>b.onclick=()=>alert(`${b.dataset.info} غير مفعّلة في هذه النسخة.`));
refresh();