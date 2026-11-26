'use strict';
// SDP Print Hub: layar mengikuti simulasi yang disetujui. Semua aturan dan hak akses ditegakkan di server;
// pemeriksaan di sini hanya untuk tampilan. Data dinamis dirender lewat textContent.
const ROLES={master:'Master Akun',manager:'Manager',spv:'SPV SDP',cs:'CS (DTF + Sublim)',crm:'CRM',store:'Store Head',op:'Operator Produksi',qc:'QC',gudang:'Gudang',fat:'FAT / Finance'};
const PAGES={masuk:'Masuk',dashboard:'Dashboard',input:'Input Order',cs:'Meja CS',cekfile:'Cek File',toko:'Order Toko Saya',produksi:'Antrian Produksi',qc:'QC',serah:'Serah Terima',bayar:'Pembayaran',
pelanggan:'Pelanggan B2B',stok:'SKU & Inventory',loss:'Loss Sales & Log QC',laporan:'Laporan',layanan:'Layanan & Harga',lacak:'Lacak Order',atur:'Pengaturan',pengguna:'Pengguna',akses:'Hak Akses',data:'Kelola Data',akun:'Akun Saya'};
const GROUPS=[['Ringkasan',['dashboard','laporan']],['Order',['input','cs','toko','pelanggan','lacak']],['Produksi',['cekfile','produksi','qc','serah']],['Keuangan dan data',['bayar','stok','loss']],['Referensi',['layanan']],['Admin',['atur','pengguna','akses','data']],['Akun',['masuk','akun']]];
const GRANTABLE=['dashboard','laporan','input','cs','toko','pelanggan','cekfile','produksi','qc','serah','bayar','stok','loss','layanan','lacak'];
const STAFF_ROLES=Object.keys(ROLES).filter(r=>r!=='master');
// Konstanta berikut harus sama dengan src/domain.ts (server yang menentukan harga dan aturan).
const RETAIL={'DTF Logo':{s:'10 x 15 cm',w:15,l:10,p:[6000,5500,4500]},'DTF A':{s:'A5, 15 x 21 cm',w:21,l:15,p:[10000,9000,7000]},'DTF B':{s:'A4, 21 x 30 cm',w:30,l:21,p:[17000,16000,12000]},'DTF C':{s:'A3, 30 x 42 cm',w:42,l:30,p:[25000,23000,18000]},'DTF D':{s:'A2, 42 x 59 cm',w:59,l:42,p:[45000,41000,32000]}};
const WIDTHS=[['priceSub120','Lebar kain sampai 120 cm'],['priceSub160','Lebar kain 121 sampai 160 cm'],['priceSub180','Lebar kain 161 sampai 180 cm']];
const MACHINES={dtf:{n:'Printer DTF Rhinotec',svc:'dtf',norm:'normDtf'},subp:{n:'Printer Sublim',svc:'sub',norm:'normSubPrint'},cal:{n:'Mesin Press / Calender',svc:'sub',norm:'normPress'}};
const STATUS={cek:['Cek file oleh Operator','warn'],revisi:['Menunggu revisi file','bad'],bayar:['Menunggu pelunasan','warn'],antrian:['Antrian cetak',''],produksi:['Sedang cetak / press',''],curing:['Powder dan curing',''],qc:['Menunggu QC','warn'],packing:['Dikemas dan dilabeli','warn'],siap:['Siap kirim','ok'],selesai:['Selesai','ok'],ditolak:['Ditolak','bad']};
const FILE_CHECKS=['Format CDR, PDF, atau PNG transparan','Ukuran sesuai order','Font sudah di-outline','Resolusi minimal 300 DPI'];
const QC_CHECKS={dtf:['Warna sesuai','Bebas garis','Tinta tidak meleber','Powder matang merata','Qty sesuai'],sub:['Warna sesuai','Bebas garis','Tidak ghosting atau berbayang','Hasil press merata','Qty dan ukuran sesuai']};
const step=(time,title,checks,photo)=>({time,title,checks,photo});
const MORNING={
 dtf:[step('08.30-08.35','Persiapan mesin',['Mesin dan area kerja bersih, aman, serta mesin menyala sesuai prosedur','Tinta putih/CMYK, PET film, dan powder adhesive tersedia dan siap digunakan']),
  step('08.35-08.45','Cleaning dan nozzle check',['Cleaning sesuai kebutuhan; hasil nozzle check lengkap tanpa garis putus atau hilang'],'Nozzle check'),
  step('08.45-08.50','Test print dan curing',['Test print file standar: detail, warna, dan gambar sesuai file','Curing sesuai parameter; powder meleleh dan menempel merata'],'Test print'),
  step('08.50-08.55','Uji press dan daya lekat',['Press pada kain uji sesuai parameter; hasil transfer rata dan tidak mudah terkelupas'],'Hasil press'),
  step('08.55-08.57','Laporan hasil',['Hasil uji press dilaporkan kepada leader; kendala dan tindakan awal dicatat jika ada']),
  step('08.57-09.00','Kesiapan produksi',['Seluruh hasil QC sudah diperiksa, bahan cukup, serta mesin dan area aman untuk produksi'])],
 subp:[step('Usulan','Persiapan printer sublim',['Mesin dan area bersih dan aman','Tinta dan kertas sublim tersedia']),step('Usulan','Nozzle check dan test print',['Nozzle check lengkap','Test print sesuai file'],'Nozzle check / test print')],
 cal:[step('Usulan','Persiapan press',['Mesin dan area bersih dan aman','Suhu dan kecepatan sesuai instruksi']),step('Usulan','Uji transfer',['Hasil transfer pada kain uji rata dan warna sesuai'],'Hasil press')]};

// Nama bawaan akun master di data lama ditampilkan sebagai nama pemegang akunnya.
const nameOf=u=>u.role==='master'&&u.name==='Admin Sistem'?'Ahmad Assidiq':u.name;
// Ikon garis sederhana (24x24).
const ICONS={grid:'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',chart:'M5 20V11M12 20V4M19 20v-6',plus:'M12 5v14M5 12h14',
 plusbox:'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 8v8M8 12h8',headset:'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z',
 store:'M4 10v10h16V10M3 10l2-6h14l2 6zM10 20v-5h4v5',users:'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M17 14.5a6 6 0 0 1 4 5.5',
 search:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',file:'M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6',layers:'M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
 check:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',box:'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',wallet:'M4 7h15a1 1 0 0 1 1 1v11H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11v3M16 13h1',
 archive:'M4 4h16v5H4zM5 9v11h14V9M10 13h4',trend:'M3 7l6 6 4-4 8 8M21 11v6h-6',tag:'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',sliders:'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
 user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',shield:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',database:'M5 6c0-4 14-4 14 0s-14 4-14 0zM5 6v12c0 4 14 4 14 0V6M5 12c0 4 14 4 14 0',
 login:'M14 4h5v16h-5M3 12h11M10 8l4 4-4 4',logout:'M10 4H5v16h5M9 12h11M16 8l4 4-4 4',refresh:'M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5l2-2.5M20 20v-5h-5',
 truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',coins:'M4 7c0-3 11-3 11 0s-11 3-11 0zM4 7v8c0 2 4 3 7 2M4 11c0 2 4 3 7 2M11 15c0-3 10-3 10 0s-10 3-10 0zM11 15v4c0 3 10 3 10 0v-4',alert:'M12 4l10 17H2zM12 10v5M12 18h.01'};
const PAGE_ICON={masuk:'login',dashboard:'grid',laporan:'chart',input:'plusbox',cs:'headset',toko:'store',pelanggan:'users',lacak:'search',cekfile:'file',produksi:'layers',qc:'check',serah:'box',bayar:'wallet',stok:'archive',loss:'trend',layanan:'tag',atur:'sliders',pengguna:'user',akses:'shield',data:'database',akun:'user'};
function icon(name){const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg'),p=document.createElementNS(NS,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','i');svg.setAttribute('aria-hidden','true');p.setAttribute('d',ICONS[name]);svg.append(p);return svg;}

let me=null,S=null,PUB=null;
// Backend: kosong = server Vercel + Supabase; berisi URL Apps Script = Google Spreadsheet (sementara).
const SHEETS=(window.SDP_CONFIG&&window.SDP_CONFIG.sheetsUrl)||'';
const SHEETS_MAX=8*1024*1024;
let token='';try{token=sessionStorage.getItem('sdp-token')||'';}catch(e){}
const setToken=t=>{token=t;try{t?sessionStorage.setItem('sdp-token',t):sessionStorage.removeItem('sdp-token');}catch(e){}};
const money=n=>n==null?'Belum diatur':'Rp '+Math.round(n).toLocaleString('id-ID');
const num=n=>Number(n).toLocaleString('id-ID',{maximumFractionDigits:2});
const dt=t=>t?new Date(t).toLocaleString('id-ID',{timeZone:'Asia/Makassar',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' WITA':'Belum diatur';
const tier=q=>q<=11?0:q<=36?1:2;
const uid=()=>crypto.randomUUID();

function h(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k!=='value')e.setAttribute(k,v===true?'':v);}
 for(const c of kids.flat(Infinity))if(c!=null&&c!==false)e.append(c.nodeType?c:document.createTextNode(String(c)));if(attrs&&attrs.value!=null)e.value=attrs.value;return e;}
const card=(...k)=>h('div',{class:'card'},...k);
const lab=(t,el)=>h('label',{},t,el);
const sel=(aria,opts,extra={})=>h('select',{'aria-label':aria,...extra},opts.map(([v,t])=>h('option',{value:v},t)));
const table=(cols,rows,empty='Belum ada data')=>h('div',{class:'tw'},h('table',{},h('thead',{},h('tr',{},cols.map(c=>h('th',{},c[0])))),h('tbody',{},rows.length?rows.map(r=>h('tr',{},cols.map(c=>h('td',{},c[1](r))))):h('tr',{},h('td',{colspan:cols.length,class:'muted'},empty)))));
let timer;function toast(t){const e=document.getElementById('toast');e.textContent=t;e.hidden=false;clearTimeout(timer);timer=setTimeout(()=>e.hidden=true,5000);}
const copy=(text,ok)=>navigator.clipboard.writeText(text).then(()=>toast(ok),()=>toast(text));
const checklist=items=>{const boxes=items.map(()=>h('input',{type:'checkbox'}));return{view:items.map((t,i)=>h('label',{class:'row'},boxes[i],t)),values:()=>boxes.map(b=>b.checked),all:()=>boxes.every(b=>b.checked)};};

// ---------- Komunikasi dengan server ----------
const TIMEOUT=45000;
// Galat "network" berarti server tidak terjangkau atau bermasalah; layar menawarkan Coba Lagi.
const netError=(m,extra)=>Object.assign(new Error(m),{network:true},extra);
async function send(method,path,body){
 const ctl=new AbortController(),limit=setTimeout(()=>ctl.abort(),TIMEOUT);
 try{
  if(SHEETS){
   // text/plain menghindari preflight CORS, yang tidak didukung Apps Script.
   const res=await fetch(SHEETS,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({method,path,body,token}),redirect:'follow',signal:ctl.signal});
   let j=null;try{j=await res.json();}catch(e){}
   if(!j)throw netError('Apps Script tidak merespons. Periksa URL dan izin deployment.');
   return j;
  }
  const headers={};if(me?.csrf&&method!=='GET')headers['X-CSRF-Token']=me.csrf;
  if(body!==undefined)headers['Content-Type']='application/json';
  const res=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',signal:ctl.signal});
  let data=null;try{data=await res.json();}catch(e){}
  return{status:res.status,data};
 }catch(e){
  if(e.network)throw e;
  throw netError(ctl.signal.aborted?'Server terlalu lama merespons.':'Tidak dapat terhubung ke server. Periksa koneksi internet.');
 }finally{clearTimeout(limit);}
}
let pending=0;
function setPending(d){pending+=d;document.getElementById('busy').hidden=pending<=0;}
/** quiet: penyegaran latar belakang, tanpa ikon loading. */
async function api(method,path,body,quiet){
 let res;if(!quiet)setPending(1);
 try{res=await send(method,path,body);}finally{if(!quiet)setPending(-1);}
 const{status,data}=res;
 if(SHEETS&&status===200&&path==='/api/auth/login')setToken(data.token);
 if(SHEETS&&path==='/api/auth/logout')setToken('');
 if(status===401&&me){me=null;S=null;setToken('');goto('masuk');throw Object.assign(new Error('Sesi berakhir, silakan masuk lagi.'),{status});}
 if(status>=500)throw netError(data?.error||'Server bermasalah ('+status+')',{status});
 if(status>=400)throw Object.assign(new Error(data?.error||'Permintaan gagal ('+status+')'),{status});
 return data;
}
async function load(quiet){
 if(!me&&(!SHEETS||token)){try{me=await api('GET','/api/auth/me',undefined,quiet);}catch(e){if(e.status!==401&&e.status!==403)throw e;me=null;setToken('');}}
 S=me&&!me.must_change?await api('GET','/api/state',undefined,quiet):null;
 if(!S&&!PUB)PUB=await api('GET','/api/public/info',undefined,quiet);
 netOk();
}
const spinner=t=>h('div',{class:'state',role:'status'},h('span',{class:'spin big'}),h('p',{},t));
let broken=null;
function showFail(){document.getElementById('view').replaceChildren(h('div',{class:'card state',role:'alert'},h('span',{class:'ico bad'},icon('alert')),h('h2',{},'Gagal terhubung'),h('p',{},broken.message),h('button',{class:'pri',onclick:connect},icon('refresh'),'Coba Lagi')));}
/** Muat data satu layar penuh: ikon loading, lalu halaman atau pesan gagal dengan Coba Lagi. */
async function connect(){
 broken=null;netOk();document.getElementById('view').replaceChildren(spinner('Menghubungkan ke server…'));
 try{await load();}catch(e){broken=e;showFail();return false;}
 render();return true;
}
function netOk(){document.getElementById('net').hidden=true;}
function netBar(text){const bar=document.getElementById('net');
 bar.replaceChildren(icon('alert'),h('span',{},text),h('button',{class:'pri',onclick:async()=>{netOk();try{await load();render();toast('Data dimuat ulang.');}catch(e){netBar('Masih gagal. '+e.message);}}},'Coba Lagi'),h('button',{onclick:netOk},'Tutup'));bar.hidden=false;}
const oops=e=>e.network?netBar(e.message+' Periksa apakah perubahan sudah tersimpan sebelum mengulang.'):toast(e.message);
/** Jalankan aksi, muat ulang data dari server, lalu tampilkan hasilnya. Tombol dikunci selama proses. */
async function act(ev,fn,msg){
 const b=ev?.currentTarget;if(b){b.disabled=true;b.classList.add('wait');}
 try{const r=await fn();await load();render();const m=typeof msg==='function'?msg(r):msg;if(m)toast(m);}
 catch(e){oops(e);if(b){b.disabled=false;b.classList.remove('wait');}}
}
// Unggah dua langkah: izin dari server, unggah langsung ke storage, lalu konfirmasi.
async function upload(kind,file){
 if(SHEETS){
  if(file.size>SHEETS_MAX)throw new Error('Maksimal 8 MB selama memakai spreadsheet. Untuk file lebih besar, isi tautan Drive.');
  const data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>no(new Error('File tidak dapat dibaca'));r.readAsDataURL(file);});
  return(await api('POST','/api/files/upload',{kind,file_name:file.name,content_type:file.type||'application/octet-stream',data})).key;
 }
 const init=await api('POST','/api/files/init',{kind,file_name:file.name,content_type:file.type||'application/octet-stream',size_bytes:file.size});
 const{url,method,fields,file_field}=init.upload,fd=new FormData();
 for(const[k,v]of Object.entries(fields))fd.set(k,v);fd.set(file_field,file,file.name);
 const put=await fetch(url,{method,body:fd}).catch(()=>{throw netError('Unggah ke penyimpanan gagal. Periksa koneksi internet.');});if(!put.ok)throw new Error('Unggah ke penyimpanan gagal ('+put.status+')');
 await api('POST','/api/files/confirm',{key:init.key});return init.key;
}

// ---------- Bantuan data ----------
const role=()=>me?.role||'public';
const is=(...r)=>role()==='master'||r.includes(role());
const allowed=()=>S?S.pages:me?['akun']:['masuk','layanan','lacak'];
const HOME={public:'masuk',master:'dashboard',manager:'dashboard',spv:'dashboard',cs:'cs',crm:'pelanggan',store:'toko',op:'cekfile',qc:'qc',gudang:'stok',fat:'bayar'};
const home=()=>{const p=HOME[role()],ok=allowed();return ok.includes(p)?p:ok[0];};
function goto(p){if(location.hash.slice(1)===p)render();else location.hash=p;}
const meterOf=o=>o.reworkM||o.meter;
const paidOf=o=>o.pay.reduce((a,p)=>a+p.amount,0);
function payState(o){const v=paidOf(o);if(v>=o.total)return['Lunas','ok'];if(v>0)return['DP / sebagian','warn'];return['Belum bayar','bad'];}
const custOf=o=>S.customers.find(c=>c.code===o.custCode);
const custOk=o=>!o.custCode||custOf(o)?.status!=='menunggu'&&custOf(o)?.status!=='ditolak';
const busy=o=>o.status==='produksi'||o.status==='curing';
const svcTag=s=>h('span',{class:'tag '+s},s==='dtf'?'DTF':'Sublim');
const typeTag=t=>h('span',{class:'tag'},t==='retail'?'Retail':'B2B Maklon');
const stTag=o=>h('span',{class:'tag '+STATUS[o.status][1]},STATUS[o.status][0]+(o.status==='antrian'&&o.stage==='cal'?' (press)':''));
const payTag=o=>{const[t,c]=payState(o);return h('span',{class:'tag '+c},t);};
const itemsText=o=>o.items.map(i=>i.name+' '+num(i.qty)+' '+i.unit).join(', ');
const fileView=o=>o.fileKey?h('a',{href:'/api/files/'+o.fileKey},o.file+' (unduh)'):/^https?:\/\//.test(o.file)?h('a',{href:o.file,target:'_blank',rel:'noopener noreferrer'},o.file):o.file;
const trackLink=o=>location.origin+'/#lacak/'+o.track;
const billText=o=>'Halo '+o.customer+', file order '+o.id+' sudah layak cetak. Total '+money(o.total)+', sisa '+money(o.total-paidOf(o))+'. Produksi dimulai setelah lunas. Cek status: '+trackLink(o);

// Kalender produksi mengikuti pengaturan server (blok jam efektif, hari libur).
function addWork(start,sec){const c=S.calendar,M=60000,D=864e5,off=c.offsetMin*M;let left=sec*1000,day=Math.floor((start+off)/D),min=((start+off)-day*D)/M;
 for(let g=0;g<400;g++,day++,min=0){if(c.closedWeekdays.includes((day+4)%7))continue;for(const[a,b]of c.blocks){const f=Math.max(min,a);if(f>=b)continue;const av=(b-f)*M;if(left<=av)return day*D+f*M+left-off;left-=av;}}return null;}
const queueOf=m=>S.orders.filter(o=>o.stage===m&&(o.status==='antrian'||busy(o))).sort((a,b)=>busy(b)-busy(a)||(b.priority?1:0)-(a.priority?1:0)||a.approved-b.approved);
function estimates(){const out={};for(const[m,d]of Object.entries(MACHINES)){let cur=Date.now();for(const o of queueOf(m)){const n=S.settings[d.norm];if(!n){out[o.id]=null;continue;}const end=addWork(busy(o)?o.started:cur,meterOf(o)*n);out[o.id]=end;cur=Math.max(cur,end);}}return out;}

// ---------- Halaman ----------
const V={};
let tab='dtf';
const prices=()=>(S||PUB).settings;
const priceText=()=>['DAFTAR HARGA SDP','','DTF maklon: '+money(prices().priceDtf)+' per meter','','DTF retail per lembar (1-11 / 12-36 / 37+ pcs):',...Object.entries(RETAIL).map(([k,d])=>k+' ('+d.s+'): '+d.p.map(money).join(' / ')),
 ...(WIDTHS.some(([k])=>prices()[k])?['','Sublim print + press per meter:',...WIDTHS.filter(([k])=>prices()[k]).map(([k,t])=>t+': '+money(prices()[k]))]:[]),'','Kirim file siap cetak ke CS.'].join('\n');
const faq=(q,a)=>h('details',{},h('summary',{},q),h('p',{},a));
V.layanan=()=>{const isDtf=tab==='dtf',pick=(k,t)=>h('button',{class:tab===k?'pri':'','aria-pressed':tab===k?'true':'false',onclick:()=>{tab=k;render();}},t);
 const flow=a=>h('ol',{class:'steps'},a.map(t=>h('li',{},t)));
 const dtf=[card(h('div',{class:'row'},svcTag('dtf'),h('h2',{},'DTF print transfer')),h('p',{},'Gambar dicetak di film, diberi powder, lalu dikeringkan. Hasilnya transfer siap press untuk kaos dan apparel.'),flow(['CS terima file','Operator cek file','Pelunasan','Cetak film','Powder dan curing','QC','Kemas dan label','Siap kirim'])),
  card(h('h2',{},'Harga maklon'),h('p',{class:'total'},money(prices().priceDtf)+' per meter'),h('p',{class:'small muted'},'Lebar cetak 58 cm.')),
  card(h('h2',{},'Harga retail per lembar'),table([['Ukuran',([k,d])=>k+' ('+d.s+')'],['1 sampai 11 pcs',([,d])=>money(d.p[0])],['12 sampai 36 pcs',([,d])=>money(d.p[1])],['37 pcs ke atas',([,d])=>money(d.p[2])]],Object.entries(RETAIL)),h('p',{class:'small muted'},'Jumlah dihitung per ukuran dalam satu order.'))];
 const sub=[card(h('div',{class:'row'},svcTag('sub'),h('h2',{},'Sublim print dan press')),h('p',{},'Gambar dicetak di kertas sublim, lalu dipindahkan ke kain dengan press. Hasil diserahkan sampai tahap press, tanpa potong dan jahit.'),flow(['CS terima file','Operator cek file','Pelunasan','Print kertas','Press ke kain','QC','Kemas dan label','Siap kirim'])),
  card(h('h2',{},'Harga per meter'),table([['Lebar kain',r=>r[1]],['Harga per meter',r=>money(prices()[r[0]])]],WIDTHS))];
 return[h('h1',{},'Layanan dan harga'),h('div',{class:'row'},pick('dtf','DTF'),pick('sub','Sublim'),h('button',{onclick:()=>copy(priceText(),'Daftar harga disalin. Tempel di chat WhatsApp.')},'Salin daftar harga untuk chat')),isDtf?dtf:sub,
 card(h('h2',{},'Tanya jawab'),faq('Bagaimana cara order?','Kirim chat ke CS atau datang ke toko. CS atau Store Head yang memasukkan order.'),faq('File apa yang diterima?','CDR, PDF, atau PNG transparan, ukuran sesuai order, font sudah di-outline, resolusi minimal 300 DPI.'),faq('Apakah SDP membuatkan desain?','Tidak. Customer mengirim file yang sudah siap cetak.'),faq('Sampai tahap apa pekerjaan sublim?','Sampai press ke kain. Potong dan jahit tidak termasuk.'))];};

V.input=()=>{const mine=role()==='store',requestKey=uid();
 const type=h('select',{id:'type'},h('option',{value:'retail'},'Retail'),h('option',{value:'maklon'},'B2B Maklon')),svc=h('select',{id:'svc'},h('option',{value:'dtfr'},'DTF retail per ukuran'),h('option',{value:'dtfm'},'DTF maklon per meter'),h('option',{value:'sub'},'Sublim print + press'));
 const src=h('select',{id:'src'},(mine?['Toko']:['WhatsApp','Datang langsung','Toko']).map(x=>h('option',{},x))),detail=h('div'),sum=h('div',{class:'total'},'Rp 0'),who=h('div',{class:'f'});
 const custSel=h('select',{id:'custSel'},S.customers.filter(c=>c.status!=='ditolak').map(c=>h('option',{value:c.code},c.code+' · '+c.name+(c.status==='menunggu'?' (menunggu CRM)':''))),h('option',{value:'new'},'+ Customer B2B baru'));
 const cust=h('input',{id:'cust'}),wa=h('input',{id:'wa',inputmode:'tel'}),file=h('input',{id:'file',placeholder:'nama file atau tautan Drive'}),up=h('input',{id:'upload',type:'file'}),dl=h('input',{id:'dl',type:'date'}),note=h('input',{id:'note'});
 const drawWho=()=>{const b2b=type.value==='maklon',isNew=!b2b||custSel.value==='new';who.replaceChildren(...[b2b?lab('Pelanggan B2B',custSel):null,isNew?lab(b2b?'Nama bisnis baru':'Nama customer',cust):null,isNew?lab('Nomor WhatsApp',wa):null,b2b&&isNew?h('p',{class:'small muted'},'Customer baru diverifikasi CRM dulu. Order ditahan sampai disetujui.'):null].filter(Boolean));};
 const qtyInputs={};let meterInput,widthSel;
 // Pratinjau saja; harga resmi dihitung server.
 const preview=()=>{if(svc.value==='dtfr'){let t=0,any=false;for(const[k,d]of Object.entries(RETAIL)){const n=Math.floor(Number(qtyInputs[k].value)||0);if(n>0){any=true;t+=d.p[tier(n)]*n;}}sum.textContent=money(any?t:0);return;}
  const m=Number(meterInput.value)||0,p=svc.value==='dtfm'?S.settings.priceDtf:S.settings[widthSel.value];sum.textContent=p?money(m*p):'Harga belum diatur';};
 const draw=()=>{if(svc.value==='dtfr')detail.replaceChildren(h('div',{class:'f'},Object.entries(RETAIL).map(([k,d])=>{qtyInputs[k]=h('input',{id:'q-'+k.replace(' ',''),type:'number',min:0,step:1,placeholder:'0',oninput:preview});return lab(k+', '+d.s+' (pcs)',qtyInputs[k]);})));
  else{meterInput=h('input',{id:'meter',type:'number',min:0,step:'0.01',oninput:preview});widthSel=h('select',{id:'width',onchange:preview},WIDTHS.map(([k,t])=>h('option',{value:k},t)));detail.replaceChildren(h('div',{class:'f'},lab('Panjang (meter)',meterInput),svc.value==='sub'?lab('Lebar kain',widthSel):null));}sum.textContent='Rp 0';};
 custSel.addEventListener('change',drawWho);svc.addEventListener('change',draw);type.addEventListener('change',()=>{svc.value=type.value==='retail'?'dtfr':'dtfm';draw();drawWho();});draw();drawWho();
 const paid=h('input',{type:'checkbox',id:'paid'}),method=sel('Metode bayar',['Transfer','QRIS','Tunai'].map(x=>[x,x]),{id:'method',style:'width:auto'});
 const send=ev=>act(ev,async()=>{const b2b=type.value==='maklon',isNew=!b2b||custSel.value==='new';
  if(!file.value.trim()&&!up.files.length)throw new Error('Isi nama file / tautan, atau unggah berkas.');
  const body={request_key:requestKey,type:type.value,service:svc.value,source:src.value,deadline:dl.value||undefined,note:note.value||undefined,
   ...(isNew?{name:cust.value,wa:wa.value}:{customer_code:custSel.value}),
   ...(svc.value==='dtfr'?{qty:Object.fromEntries(Object.entries(qtyInputs).map(([k,i])=>[k,Number(i.value)||0]))}:{meter:Number(meterInput.value),width:svc.value==='sub'?widthSel.value:undefined}),
   paid_method:paid.checked?method.value:undefined};
  if(up.files.length)body.file_key=await upload('artwork',up.files[0]);
  body.file_ref=file.value.trim()||up.files[0].name;
  const r=await api('POST','/api/orders',body);location.hash=mine?'toko':'cs';return r;},r=>'Order '+r.order_no+' dikirim ke Operator untuk cek file.');
 return[h('h1',{},'Input order'),h('p',{class:'muted'},(mine?'Masukkan order customer yang datang ke toko.':'Terima file (CDR, PDF, PNG transparan), ukuran, dan qty dari chat atau customer yang datang.')+' Operator akan memeriksa file.'),
 card(h('div',{class:'f'},lab('Jenis customer',type),lab('Sumber order',src),lab('Layanan',svc),lab('Nama file / tautan Drive',file),lab('Unggah berkas (opsional, maks '+(SHEETS?8:50)+' MB)',up),lab('Deadline',dl),lab('Catatan',note))),
 card(h('h2',{},'Customer'),who),
 card(h('h2',{},'Rincian'),detail,h('div',{class:'mt'},sum),h('div',{class:'row mt'},h('label',{class:'row'},paid,'Pembayaran lunas sudah diterima'),method),h('div',{class:'mt'},h('button',{class:'pri',onclick:send},'Simpan dan kirim ke Operator')))];};

V.toko=()=>{const list=S.orders.filter(o=>role()==='store'?o.createdBy===me.code:o.source==='Toko').slice().reverse();
 return[h('h1',{},'Order toko saya'),h('p',{class:'muted'},'Status order yang dimasukkan dari toko.'),card(table([['Order',o=>h('span',{},o.id,h('br'),h('span',{class:'small muted'},o.customer))],['Rincian',itemsText],['Total',o=>money(o.total)],['Status',stTag],['Bayar',payTag],['Resi',o=>h('button',{onclick:()=>copy(trackLink(o),'Tautan lacak disalin.')},'Salin tautan')]],list,'Belum ada order dari toko.'))];};

V.pelanggan=()=>{const verify=is('crm'),decide=(c,st)=>ev=>act(ev,()=>api('POST','/api/customers/'+c.id+'/decide',{status:st}),c.name+(st==='aktif'?' disetujui.':' ditolak.'));
 const wait=S.customers.filter(c=>c.status==='menunggu'),paste=h('textarea',{rows:5,'aria-label':'Daftar pelanggan',placeholder:'kode;nama bisnis;nomor whatsapp\nTK-0001;Nama Konveksi;0812xxxx'});
 const imp=ev=>act(ev,()=>{const rows=paste.value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const[code,name,wa]=l.split(/[;\t]/).map(x=>(x||'').trim());return{code,name,wa};});return api('POST','/api/customers/import',{rows});},r=>r.added+' pelanggan ditambahkan, '+r.skipped+' sudah ada.');
 return[h('h1',{},'Pelanggan B2B'),h('p',{class:'muted'},'Pelanggan B2B Tigalapan Kaos yang sudah terdaftar dapat langsung diimpor. CRM memverifikasi customer baru.'),
 card(h('h2',{},'Customer baru menunggu verifikasi'),table([['Kode',c=>c.code],['Nama',c=>c.name],['WhatsApp',c=>c.wa],['Keputusan',c=>verify?h('div',{class:'row'},h('button',{class:'pri',onclick:decide(c,'aktif')},'Setujui'),h('button',{class:'d',onclick:decide(c,'ditolak')},'Tolak')):'Menunggu CRM']],wait,'Tidak ada customer baru')),
 verify?card(h('h2',{},'Impor pelanggan terdaftar'),h('p',{class:'small muted'},'Satu pelanggan per baris. Bisa ditempel langsung dari Excel (kolom kode, nama, WhatsApp). Kode yang sudah ada dilewati.'),paste,h('div',{class:'mt'},h('button',{class:'pri',onclick:imp},'Impor'))):null,
 card(h('h2',{},'Daftar pelanggan'),table([['Kode',c=>c.code],['Nama',c=>c.name],['Asal',c=>c.source],['Status',c=>h('span',{class:'tag '+({aktif:'ok',menunggu:'warn',ditolak:'bad'})[c.status]},c.status)],['Order',c=>S.orders.filter(o=>o.custCode===c.code).length]],S.customers))];};

// ---------- Kelola Data (master) ----------
const del=(path,question,msg)=>ev=>{if(confirm(question+' Tindakan ini tidak dapat dibatalkan.'))act(ev,()=>api('DELETE',path),msg);};
let dataTab='order',editId=null;
function editOrder(o){const f=(v,a)=>h('input',{value:v??'','aria-label':a}),name=f(o.customer,'Nama customer'),wa=f(o.wa,'WhatsApp'),file=f(o.file,'File'),note=f(o.note,'Catatan'),dl=h('input',{type:'date',value:o.deadline??''});
 const st=sel('Status',Object.entries(STATUS).filter(([k])=>o.service==='dtf'||k!=='curing').map(([k,v])=>[k,v[0]]),{value:o.status});
 const stage=sel('Tahap mesin',(o.service==='dtf'?['dtf']:['subp','cal']).map(m=>[m,MACHINES[m].n]),{value:o.stage});
 return card(h('h2',{},'Ubah '+o.id),h('div',{class:'f'},lab('Nama customer',name),lab('WhatsApp',wa),lab('Nama file / tautan',file),lab('Catatan',note),lab('Deadline',dl),lab('Status',st),lab('Tahap mesin',stage)),h('p',{class:'small muted'},'Jumlah dan harga tidak diubah di sini. Bila salah, hapus order lalu input ulang.'),
  h('div',{class:'row mt'},h('button',{class:'pri',onclick:ev=>act(ev,async()=>{await api('PATCH','/api/manage/orders/'+o.dbId,{customer_name:name.value,wa:wa.value,file_ref:file.value,note:note.value,deadline:dl.value,status:st.value,stage:stage.value});editId=null;},'Order diubah.')},'Simpan perubahan'),h('button',{onclick:()=>{editId=null;render();}},'Batal')));}
V.data=()=>{const tabs=[['order','Order'],['bayar','Pembayaran'],['pelanggan','Pelanggan'],['qc','QC pagi'],['log','Loss & Log QC'],['stok','Stok'],['reset','Bersihkan data']];
 const body={
  order:()=>{const o=S.orders.find(x=>x.dbId===editId);return[o?editOrder(o):null,card(table([['Order',x=>x.id],['Customer',x=>x.customer],['Total',x=>money(x.total)],['Status',stTag],['Aksi',x=>h('div',{class:'row'},h('button',{onclick:()=>{editId=x.dbId;render();scrollTo(0,0);}},'Ubah'),h('button',{class:'d',onclick:del('/api/manage/orders/'+x.dbId,'Hapus order '+x.id+' beserta pembayaran, log, dan pemakaian bahannya?','Order dihapus.')},'Hapus'))]],S.orders.slice().reverse()))];},
  bayar:()=>card(h('p',{class:'small muted'},'Menghapus pembayaran tidak mengubah status order. Sesuaikan status lewat tab Order bila perlu.'),table([['Waktu',x=>dt(x.p.at)],['Order',x=>x.o.id],['Nominal',x=>money(x.p.amount)],['Metode',x=>x.p.method],['Aksi',x=>h('button',{class:'d',onclick:del('/api/manage/payments/'+x.p.id,'Hapus pembayaran '+money(x.p.amount)+' pada '+x.o.id+'?','Pembayaran dihapus.')},'Hapus')]],S.orders.flatMap(o=>o.pay.map(p=>({o,p}))).sort((a,b)=>b.p.at-a.p.at))),
  pelanggan:()=>card(table([['Kode',c=>c.code],['Nama, WhatsApp, status',c=>{const n=h('input',{value:c.name,'aria-label':'Nama '+c.code}),w=h('input',{value:c.wa,'aria-label':'WhatsApp '+c.code}),s=sel('Status '+c.code,['aktif','menunggu','ditolak'].map(x=>[x,x]),{value:c.status});return h('div',{class:'row'},n,w,s,h('button',{onclick:ev=>act(ev,()=>api('PATCH','/api/manage/customers/'+c.id,{name:n.value,wa:w.value,status:s.value}),c.code+' disimpan.')},'Simpan'),h('button',{class:'d',onclick:del('/api/manage/customers/'+c.id,'Hapus pelanggan '+c.name+'?','Pelanggan dihapus.')},'Hapus'));}]],S.customers)),
  qc:()=>card(table([['Waktu',r=>dt(r.at)],['Mesin',r=>MACHINES[r.machine].n],['Status',r=>QC_STATE[r.status][0]],['Aksi',r=>h('button',{class:'d',onclick:del('/api/manage/qc/'+r.id,'Hapus laporan QC ini?','Laporan QC dihapus.')},'Hapus')]],S.qcReports.slice().reverse())),
  log:()=>card(table([['Waktu',l=>dt(l.at)],['Order',l=>l.id],['Jenis',l=>l.type],['Alasan',l=>l.reason],['Aksi',l=>h('button',{class:'d',onclick:del('/api/manage/logs/'+l.logId,'Hapus catatan ini?','Catatan dihapus.')},'Hapus')]],S.loss)),
  stok:()=>card(h('p',{class:'small muted'},'Mengganti angka stok langsung, untuk membetulkan data simulasi. Untuk pemakaian harian gunakan Catat mutasi di SKU & Inventory.'),table([['SKU',k=>k.code],['Nama',k=>k.name],['Stok',k=>{const v=h('input',{type:'number',min:0,step:'0.01',value:k.stock,'aria-label':'Stok '+k.code,style:'width:110px'});return h('div',{class:'row'},v,k.unit,h('button',{onclick:ev=>act(ev,()=>api('PUT','/api/manage/stock/'+k.code,{stock:Number(v.value)}),k.code+' disimpan.')},'Simpan'));}]],S.skus)),
  reset:()=>{const word=h('input',{'aria-label':'Konfirmasi',placeholder:'ketik HAPUS SEMUA',style:'max-width:240px'}),cust=h('input',{type:'checkbox'});
   return card(h('h2',{},'Bersihkan data simulasi'),h('p',{},'Menghapus semua order, pembayaran, log, QC pagi, riwayat stok, dan catatan file, serta mengembalikan stok ke 0. Akun, harga, hak akses, dan daftar SKU tetap. Tidak dapat dibatalkan.'),h('label',{class:'row'},cust,'Hapus juga daftar pelanggan'),h('div',{class:'row mt'},word,h('button',{class:'d',onclick:ev=>{if(word.value!=='HAPUS SEMUA')return toast('Ketik HAPUS SEMUA untuk melanjutkan.');act(ev,()=>api('POST','/api/manage/reset',{confirm:word.value,customers:cust.checked}),'Data simulasi sudah dibersihkan.');}},'Bersihkan sekarang')));}
 };
 return[h('h1',{},'Kelola data'),h('p',{class:'muted'},'Khusus Master Akun. Setiap perubahan tercatat di audit log.'),h('div',{class:'row'},tabs.map(([k,t])=>h('button',{class:dataTab===k?'pri':'',onclick:()=>{dataTab=k;editId=null;render();}},t))),body[dataTab]()];};

let trackArg='';
V.lacak=()=>{const out=h('div'),box=h('input',{id:'code',value:trackArg,style:'max-width:300px','aria-label':'Kode resi'});
 const show=async()=>{const c=box.value.trim().split('/').pop();if(!c)return;try{const d=await api('GET','/api/public/track/'+encodeURIComponent(c));
  const keys=['cek','bayar','antrian','produksi','curing','qc','packing','siap','selesai'].filter(k=>d.service==='dtf'||k!=='curing'),i=keys.indexOf(d.status==='revisi'?'cek':d.status);
  out.replaceChildren(card(h('h2',{},itemsText(d)),h('div',{class:'row'},svcTag(d.service),h('span',{class:'tag '+STATUS[d.status][1]},STATUS[d.status][0])),h('ol',{class:'steps'},keys.map((k,j)=>h('li',{class:j<i?'done':j===i?'on':''},STATUS[k][0]))),['antrian','produksi','curing'].includes(d.status)?h('p',{},'Perkiraan selesai tahap ini: '+dt(d.estimate)):null));}
  catch(e){out.replaceChildren(card(h('p',{},e.message)));}};
 if(trackArg)show();
 return[h('h1',{},'Lacak order'),card(h('div',{class:'row'},box,h('button',{class:'pri',onclick:show},'Cek status')),h('p',{class:'small muted'},'Resi dikirim CS lewat chat. Halaman ini tidak menampilkan nama, nomor telepon, harga, atau catatan internal.')),out];};

const kpi=(t,v,s)=>card(h('div',{class:'small muted'},t),h('div',{class:'kpi'},v),h('div',{class:'small muted'},s));
const live=()=>S.orders.filter(o=>o.status!=='ditolak');
const sumOf=(list,fn)=>list.reduce((a,o)=>a+(fn(o)||0),0);
const count=(...st)=>S.orders.filter(o=>st.includes(o.status)).length;
// Dashboard: periode menyaring menurut tanggal order diinput (dan tanggal loss sales).
const PERIODS=[['all','Semua periode'],['1','Hari ini'],['7','7 hari terakhir'],['30','30 hari terakhir']];
let period='all',dashSvc='all';
function since(){if(period==='all')return 0;const off=S.calendar.offsetMin*60000,D=864e5;return Math.floor((Date.now()+off)/D)*D-off-(Number(period)-1)*D;}
const stat=(ic,t,v,s)=>h('div',{class:'stat'},h('span',{class:'ico'},icon(ic)),h('div',{},h('div',{class:'st'},t),h('div',{class:'kpi'+(String(v).length>12?' xl':String(v).length>8?' l':'')},v),h('div',{class:'small muted'},s)));
V.dashboard=()=>{const from=since(),orders=S.orders.filter(o=>o.created>=from),n=(...st)=>orders.filter(o=>st.includes(o.status)).length;
 const open=orders.filter(o=>!['selesai','ditolak'].includes(o.status)),low=S.skus.filter(k=>k.min>0&&k.stock<=k.min),loss=S.loss.filter(l=>l.count&&l.at>=from).reduce((a,l)=>a+(l.value||0),0);
 const queued=m=>queueOf(m).filter(o=>o.created>=from),dtf=queued('dtf'),sub=queued('subp').concat(queued('cal')),est=estimates();
 const rows=dtf.concat(sub).filter(o=>dashSvc==='all'||o.service===dashSvc);
 const flow=[['Cek file','Pengecekan kelengkapan dan kesiapan file.',n('cek')],['Produksi','Proses cetak DTF atau sublimasi.',n('antrian','produksi','curing')],['QC dan kemas','Pemeriksaan hasil cetak dan pengemasan.',n('qc','packing')],['Siap kirim','Order siap diserahkan ke pelanggan.',n('siap')]];
 return[h('div',{class:'head'},h('div',{},h('h1',{},'Dashboard SDP'),h('p',{class:'muted'},'Ringkasan operasional DTF & Sublimasi')),
   h('div',{class:'row'},sel('Periode order',PERIODS,{value:period,onchange:e=>{period=e.target.value;render();}}),allowed().includes('input')?h('a',{class:'btn pri big',href:'#input'},icon('plus'),'Input Order'):null)),
  period==='all'?null:h('p',{class:'small muted'},'Angka mencakup order yang diinput dalam periode terpilih. SKU di bawah minimum selalu kondisi saat ini.'),
  h('div',{class:'stats'},stat('file','Menunggu cek file',n('cek'),'Order menunggu pengecekan file.'),stat('refresh','Menunggu revisi',n('revisi'),'Order perlu revisi file atau desain.'),
   stat('layers','Antrian DTF',num(sumOf(dtf,meterOf))+' m',dtf.length+' order di antrian produksi.'),stat('layers','Antrian Sublim',num(sumOf(sub,meterOf))+' m',sub.length+' order, print dan press.'),
   stat('wallet','Menunggu pelunasan',n('bayar'),'Belum boleh diproses.'),stat('box','QC dan kemas',n('qc','packing'),'Order dalam proses QC dan pengemasan.'),
   stat('truck','Siap kirim',n('siap'),'Order siap diserahkan.'),stat('coins','Nilai order berjalan',money(sumOf(open,o=>o.total)),'Belum tentu sudah dibayar.'),
   stat('trend','Loss sales',money(loss),'Double input tidak dihitung.'),stat('alert','SKU di bawah minimum',low.length,low.map(x=>x.code).join(', ')||'Semua aman.')),
  h('div',{class:'panels'},
   card(h('h2',{},'Antrian Produksi'),h('div',{class:'tabs'},[['all','Semua'],['dtf','DTF'],['sub','Sublimasi']].map(([k,t])=>h('button',{'aria-pressed':String(dashSvc===k),onclick:()=>{dashSvc=k;render();}},t))),
    rows.length?table([['No. Order',o=>o.id],['Pelanggan',o=>o.customer],['Layanan',o=>svcTag(o.service)],['Status',stTag],['Target',o=>est[o.id]?dt(est[o.id]):o.deadline?'Deadline '+o.deadline:'Belum diatur']],rows)
     :h('div',{class:'state'},h('span',{class:'ico plain'},icon('layers')),h('h3',{},'Belum ada antrian produksi'),h('p',{class:'muted'},'Order yang siap diproses akan tampil di sini.'))),
   card(h('h2',{},'Alur Operasional'),h('ol',{class:'flow'},flow.map(([t,d,c],i)=>h('li',{},h('span',{class:'no'},i+1),h('div',{},h('b',{},t),h('div',{class:'small muted'},d)),h('span',{class:'cnt'},c))))))];};
V.laporan=()=>{const group=(title,keys,get)=>card(h('h2',{},title),table([[title,k=>k[1]],['Order',k=>live().filter(o=>get(o)===k[0]).length],['Meter',k=>num(sumOf(live().filter(o=>get(o)===k[0]),o=>o.meter))],['Nilai order',k=>money(sumOf(live().filter(o=>get(o)===k[0]),o=>o.total))],['Dibayar',k=>money(sumOf(live().filter(o=>get(o)===k[0]),paidOf))]],keys));
 return[h('h1',{},'Laporan'),h('p',{class:'muted'},'Mencakup semua order berjalan dan 300 order selesai atau ditolak terakhir. Nilai order, pembayaran, dan loss sales dipisah.'),group('Layanan',[['dtf','DTF'],['sub','Sublim']],o=>o.service),group('Jenis customer',[['retail','Retail'],['maklon','B2B Maklon']],o=>o.type),group('Sumber order',[['WhatsApp','WhatsApp'],['Datang langsung','Datang langsung'],['Toko','Toko']],o=>o.source)];};

V.cs=()=>{const list=S.orders.filter(o=>['cek','revisi','bayar'].includes(o.status)),acting=is('cs','spv');
 return[h('h1',{},'Meja CS'),h('p',{class:'muted'},'Satu CS menangani DTF dan Sublim: terima file, teruskan permintaan revisi dari Operator, dan pastikan order lunas sebelum antrian.'),list.length?list.map(o=>{
 const why=sel('Alasan tolak',['Harga tidak cocok','Customer batal','Deadline tidak terkejar','Bahan habis','Double input'].map(x=>[x,x]));
 const reject=h('button',{class:'d',onclick:ev=>act(ev,()=>api('POST',`/api/orders/${o.dbId}/reject`,{reason:why.value}),r=>r.paid>0?'Order ditolak. Sudah ada pembayaran '+money(r.paid)+', selesaikan pengembalian secara manual.':'Order ditolak.')},'Tolak');
 const next=h('input',{placeholder:'Nama file / tautan revisi','aria-label':'File revisi',style:'width:220px'}),nextUp=h('input',{type:'file','aria-label':'Unggah revisi'});
 let body;
 if(!custOk(o))body=h('span',{class:'tag warn'},custOf(o)?.status==='ditolak'?'Customer ditolak CRM':'Menunggu verifikasi CRM');
 else if(o.status==='cek')body=h('span',{class:'tag warn'},'Menunggu Operator memeriksa file');
 else if(o.status==='revisi')body=[h('button',{onclick:()=>copy('Halo '+o.customer+', file order '+o.id+' belum layak cetak: '+o.issue+'. Mohon kirim file revisi.','Pesan revisi disalin.')},'Salin permintaan revisi'),next,nextUp,h('button',{class:'pri',onclick:ev=>act(ev,async()=>{if(!next.value.trim()&&!nextUp.files.length)throw new Error('Isi atau unggah file revisi dari customer.');const key=nextUp.files.length?await upload('artwork',nextUp.files[0]):undefined;return api('POST',`/api/orders/${o.dbId}/revise`,{file_ref:next.value.trim()||nextUp.files[0].name,file_key:key});},'File revisi dikirim ke Operator.')},'Kirim ulang ke Operator')];
 else body=[h('button',{onclick:()=>copy(billText(o),'Pesan tagihan disalin.')},'Salin pesan tagihan'),h('a',{class:'btn pri',href:'#bayar'},'Catat pembayaran')];
 return card(h('div',{class:'row'},h('h3',{},o.id+' · '+o.customer),svcTag(o.service),typeTag(o.type),stTag(o),payTag(o)),h('p',{},itemsText(o),h('br'),'Sumber '+o.source+' · '+o.wa+' · File: ',fileView(o),h('br'),num(meterOf(o))+' m · Total '+money(o.total)+(o.deadline?' · Deadline '+o.deadline:'')+(o.note?' · '+o.note:'')),h('p',{},h('button',{onclick:()=>copy(trackLink(o),'Tautan lacak disalin.')},'Salin tautan lacak')),o.status==='revisi'?h('p',{class:'small',style:'color:var(--bad)'},'Catatan Operator: '+o.issue):null,acting?h('div',{class:'row'},body,why,reject):null);}):card(h('p',{},'Tidak ada order yang menunggu CS.'))];};

V.cekfile=()=>{const list=S.orders.filter(o=>o.status==='cek'),acting=is('op','spv');
 return[h('h1',{},'Cek file'),h('p',{class:'muted'},'Pemeriksaan pre-press oleh Operator. File layak diteruskan ke antrian setelah lunas; file bermasalah dikembalikan ke CS.'),list.length?list.map(o=>{const c=checklist(FILE_CHECKS),why=h('input',{placeholder:'Kendala file (wajib bila tidak layak)','aria-label':'Kendala file',style:'width:260px'});
 return card(h('div',{class:'row'},h('h3',{},o.id+' · '+o.customer),svcTag(o.service),payTag(o)),h('p',{},itemsText(o),h('br'),'File: ',fileView(o),o.note?h('span',{},h('br'),'Catatan: '+o.note):null),!custOk(o)?h('span',{class:'tag warn'},'Menunggu verifikasi customer oleh CRM'):acting?[c.view,h('div',{class:'row mt'},h('button',{class:'pri',onclick:ev=>{if(!c.all())return toast('Centang semua butir, atau tandai tidak layak.');act(ev,()=>api('POST',`/api/orders/${o.dbId}/file-check`,{ok:true,checks:c.values()}),r=>r.released?'File layak. Order lunas dan masuk antrian cetak.':'File layak. CS diminta menagih pelunasan.');}},'File layak'),why,h('button',{class:'d',onclick:ev=>{if(!why.value.trim())return toast('Tulis kendala file.');act(ev,()=>api('POST',`/api/orders/${o.dbId}/file-check`,{ok:false,issue:why.value}),'Dikembalikan ke CS untuk revisi customer.');}},'Tidak layak'))]:null);}):card(h('p',{},'Tidak ada file yang menunggu diperiksa.'))];};

const QC_STATE={menunggu:['QC pagi: menunggu persetujuan','warn'],siap:['QC pagi: siap produksi','ok'],tahan:['QC pagi: tahan produksi','bad']};
const qcToday=m=>S.qcReports.filter(r=>r.machine===m&&r.day===S.today).pop();
const qcTag=m=>{const[t,c]=QC_STATE[qcToday(m)?.status]||['QC pagi belum diisi','warn'];return h('span',{class:'tag '+c},t);};

V.produksi=()=>{const est=estimates(),run=is('op','spv'),lead=is('spv');return[h('h1',{},'Antrian produksi'),h('p',{class:'muted'},'Estimasi mengikuti jam efektif dan hari libur di server. Satu mesin satu pekerjaan. Hanya order dengan file layak dan lunas yang masuk antrian.'),Object.entries(MACHINES).map(([m,d])=>{const q=queueOf(m),n=S.settings[d.norm];
 const post=(o,path,body,msg)=>ev=>act(ev,()=>api('POST',`/api/orders/${o.dbId}/${path}`,body?body():{}),msg);
 const action=o=>{if(o.status==='antrian')return[run?h('button',{class:'pri',onclick:post(o,'start',null,m==='cal'?'Press dimulai.':'Cetak dimulai. Pastikan setting RIP: mirror'+(m==='dtf'?' dan white underbase.':'.'))},m==='cal'?'Mulai press':'Mulai cetak'):null,lead?h('button',{onclick:post(o,'priority',()=>({on:!o.priority}),o.priority?'Prioritas dilepas.':'Order diprioritaskan.')},o.priority?'Lepas prioritas':'Prioritaskan'):null];
  if(!run)return null;
  if(m==='dtf'&&o.status==='produksi')return h('button',{class:'pri',onclick:post(o,'curing',null,'Lanjut powdering dan curing.')},'Selesai cetak, lanjut curing');
  if(m==='subp')return h('button',{class:'pri',onclick:post(o,'finish',null,'Print selesai. Order lanjut ke antrian press.')},'Selesai cetak');
  const t=h('input',{type:'number',placeholder:'Suhu °C','aria-label':'Suhu',style:'width:95px'}),s=h('input',{type:'number',placeholder:'Detik','aria-label':'Lama detik',style:'width:85px'});
  return[t,s,h('button',{class:'pri',onclick:ev=>{if(!(Number(t.value)>0&&Number(s.value)>0))return toast('Isi suhu dan lama proses.');post(o,'finish',()=>({temp:Number(t.value),seconds:Number(s.value)}),r=>r.deducted?'Selesai. Pemakaian bahan dipotong dari stok, order menunggu QC.':'Selesai. Order menunggu QC. Pemakaian per meter belum diatur, stok tidak dipotong.')(ev);}},m==='dtf'?'Selesai curing':'Selesai press')];};
 return card(h('div',{class:'row'},h('h2',{},d.n),svcTag(d.svc),qcTag(m),h('span',{class:'tag'},n?num(n/60)+' menit per meter':'Norma belum diatur')),m==='dtf'?h('p',{class:'small muted'},'Curing standar: 130 sampai 150 °C, 60 sampai 90 detik, tekstur kulit jeruk merata.'):null,table([['Order',o=>h('span',{},o.id,o.priority?h('span',{class:'tag warn'},'Prioritas'):null,h('br'),h('span',{class:'small muted'},o.customer))],['Meter',o=>num(meterOf(o))],['File',fileView],['Status',stTag],['Estimasi selesai',o=>dt(est[o.id])],['Aksi',o=>h('div',{class:'row'},action(o))]],q,'Antrian kosong'));})];};

let qcMachine='dtf';
function morningForm(m){const rows=[],photos=[];
 const groups=MORNING[m].map(g=>h('div',{class:'mt'},h('h3',{},g.time+' · '+g.title),g.checks.map(t=>{const s=sel(t,[['','Pilih'],['OK','OK'],['NG','Tidak sesuai']],{style:'width:150px'});rows.push(s);return h('div',{class:'row',style:'justify-content:space-between;margin-bottom:6px'},h('span',{style:'flex:1;min-width:200px'},t),s);}),
  g.photo?(()=>{const file=h('input',{type:'file',accept:'image/*','aria-label':'Foto '+g.photo});photos.push({label:g.photo,file});return h('label',{class:'row small'},'Foto wajib: '+g.photo,file);})():null));
 const note=h('input',{placeholder:'Temuan (wajib bila ada yang tidak sesuai)','aria-label':'Temuan'}),action=h('input',{placeholder:'Tindakan awal (wajib bila ada yang tidak sesuai)','aria-label':'Tindakan awal'});
 const send=ev=>{if(rows.some(r=>!r.value))return toast('Setiap butir wajib dipilih OK atau Tidak sesuai.');
  const miss=photos.find(p=>!p.file.files.length);if(miss)return toast('Lampirkan foto '+miss.label+'.');if(rows.some(r=>r.value==='NG')&&(!note.value.trim()||!action.value.trim()))return toast('Temuan dan tindakan awal wajib diisi.');
  act(ev,async()=>{const up=[];for(const p of photos)up.push({label:p.label,key:await upload('qc_photo',p.file.files[0])});return api('POST','/api/qc/morning',{machine:m,answers:rows.map(r=>r.value),photos:up,note:note.value,action:action.value});},'Laporan QC pagi terkirim, menunggu persetujuan leader.');};
 return[groups,h('div',{class:'f mt'},note,action),h('div',{class:'mt'},h('button',{class:'pri',onclick:send},'Kirim laporan QC pagi'))];}
function qcApproval(r){const ln=h('input',{placeholder:'Catatan leader','aria-label':'Catatan leader',style:'width:200px'});
 const decide=st=>ev=>act(ev,()=>api('POST',`/api/qc/morning/${r.id}/decide`,{decision:st,note:ln.value}),st==='siap'?'Disetujui. Mesin siap produksi.':'Produksi ditahan.');
 return h('div',{class:'row'},is('spv')&&r.status==='menunggu'?[ln,h('button',{class:'pri',onclick:decide('siap')},'Setujui'),h('button',{class:'d',onclick:decide('tahan')},'Tahan produksi')]:h('span',{class:'small muted'},r.approvedBy?'Oleh '+r.approvedBy+(r.leaderNote?': '+r.leaderNote:''):'Menunggu SPV'));}
V.qc=()=>{const wait=S.orders.filter(o=>o.status==='qc'),pack=S.orders.filter(o=>o.status==='packing'),acting=is('op','qc','spv'),cur=qcToday(qcMachine),reports=S.qcReports.slice().reverse();
 return[h('h1',{},'QC'),h('p',{class:'muted'},'Dikerjakan petugas QC atau Operator. QC pagi harus disetujui leader sebelum mesin dipakai.'),
 card(h('h2',{},'QC pagi mesin (STD-OPR-006, 08.30 sampai 09.00)'),h('div',{class:'row'},Object.entries(MACHINES).map(([m,d])=>h('button',{class:qcMachine===m?'pri':'',onclick:()=>{qcMachine=m;render();}},d.n))),h('div',{class:'mt'},qcTag(qcMachine)),
  qcMachine!=='dtf'?h('p',{class:'small muted'},'Checklist mesin sublim masih usulan, menunggu SOP final.'):null,
  !acting?null:cur&&cur.status!=='tahan'?h('p',{class:'small muted mt'},'Laporan hari ini sudah dikirim.'):morningForm(qcMachine)),
 card(h('h2',{},'Laporan QC pagi'),table([['Waktu',r=>dt(r.at)],['Mesin',r=>MACHINES[r.machine].n],['Operator',r=>r.by],['Hasil',r=>r.ng.length?h('span',{},h('span',{class:'tag bad'},r.ng.length+' tidak sesuai'),h('br'),h('span',{class:'small'},r.note+'. Tindakan: '+r.action)):h('span',{class:'tag ok'},'Semua OK')],['Foto',r=>r.photos.map(p=>h('div',{},h('a',{href:'/api/files/'+p.key},p.label)))],['Status',r=>h('span',{class:'tag '+QC_STATE[r.status][1]},QC_STATE[r.status][0].replace('QC pagi: ',''))],['Persetujuan leader',qcApproval]],reports,'Belum ada laporan')),
 h('h2',{class:'mt'},'Inspeksi hasil cetak'),wait.length?wait.map(o=>{const c=checklist(QC_CHECKS[o.service]),rj=h('input',{type:'number',min:0,step:'0.01',placeholder:'Reject (m)','aria-label':'Meter reject',style:'width:110px'});
  return card(h('div',{class:'row'},h('h3',{},o.id+' · '+o.customer),svcTag(o.service)),h('p',{},itemsText(o)+' · '+num(meterOf(o))+' m'+(o.process?' · '+o.process:'')),o.service==='sub'?h('p',{class:'small muted'},'Butir QC sublim masih usulan, menunggu SOP final.'):null,acting?[c.view,h('div',{class:'row mt'},h('button',{class:'pri',onclick:ev=>{if(!c.all())return toast('Centang semua butir, atau catat reject.');act(ev,()=>api('POST',`/api/orders/${o.dbId}/qc`,{pass:true,checks:c.values()}),'Lolos QC. Lanjut kemas dan label.');}},'Lolos QC'),rj,h('button',{class:'d',onclick:ev=>{if(!(Number(rj.value)>0))return toast('Isi meter reject.');act(ev,()=>api('POST',`/api/orders/${o.dbId}/qc`,{pass:false,reject_m:Number(rj.value)}),'Reject dicatat di Log QC. Masuk antrian cetak ulang, lalu QC ulang.');}},'Tidak lolos'))]:null);}):card(h('p',{},'Tidak ada hasil menunggu QC.')),
 h('h2',{class:'mt'},'Kemas dan label'),card(table([['Order',o=>o.id+' · '+o.customer],['Layanan',o=>svcTag(o.service)],['Aksi',o=>acting?h('button',{class:'pri',onclick:ev=>act(ev,()=>api('POST',`/api/orders/${o.dbId}/pack`,{}),'Ditempatkan di area siap kirim.')},'Sudah dikemas dan berlabel'):'Menunggu petugas']],pack,'Tidak ada yang perlu dikemas'))];};

V.serah=()=>[h('h1',{},'Serah terima'),card(table([['Order',o=>o.id+' · '+o.customer],['Ambil di',o=>o.store==='-'?'Workshop SDP':o.store],['Layanan',o=>svcTag(o.service)],['Bayar',payTag],['Penerima',o=>{if(!is('cs','spv','gudang'))return'-';const n=h('input',{placeholder:'Nama penerima','aria-label':'Nama penerima'});return h('div',{class:'row'},n,h('button',{class:'pri',onclick:ev=>{if(!n.value.trim())return toast('Isi nama penerima.');act(ev,()=>api('POST',`/api/orders/${o.dbId}/handover`,{receiver:n.value}),'Diserahkan. Order selesai.');}},'Serahkan'));}]],S.orders.filter(o=>o.status==='siap'),'Belum ada hasil siap diambil'))];

V.bayar=()=>{const record=is('cs','store'),open=live().filter(o=>paidOf(o)<o.total),requestKey=uid();
 const which=sel('Order',open.map(o=>[o.dbId,o.id+' · '+o.customer+' · sisa '+money(o.total-paidOf(o))])),amt=h('input',{type:'number',placeholder:'Nominal Rp','aria-label':'Nominal'}),met=sel('Metode',['Transfer','QRIS','Tunai'].map(x=>[x,x]));
 const all=S.orders.flatMap(o=>o.pay.map(p=>({o,p}))).sort((a,b)=>b.p.at-a.p.at).slice(0,100);
 return[h('h1',{},'Pembayaran'),h('p',{class:'muted'},'Semua order wajib lunas sebelum diproses. CS atau Store Head mencatat pembayaran yang sudah diterima; FAT melihat rekapnya.'),
 record&&open.length?card(h('h2',{},'Catat pembayaran diterima'),h('div',{class:'row'},which,amt,met,h('button',{class:'pri',onclick:ev=>{const n=Number(amt.value);if(!(Number.isInteger(n)&&n>0))return toast('Isi nominal rupiah lebih dari 0.');act(ev,()=>api('POST',`/api/orders/${which.value}/payments`,{amount:n,method:met.value,request_key:requestKey}),r=>r.released?'Lunas. Order masuk antrian cetak.':'Pembayaran dicatat.');}},'Catat'))):null,
 card(h('h2',{},'Status per order'),table([['Order',o=>o.id+' · '+o.customer],['Total',o=>money(o.total)],['Dibayar',o=>money(paidOf(o))],['Sisa',o=>money(o.total-paidOf(o))],['Status',payTag]],live().slice().reverse())),
 card(h('h2',{},'Riwayat pembayaran'),table([['Waktu',x=>dt(x.p.at)],['Order',x=>x.o.id],['Nominal',x=>money(x.p.amount)],['Metode',x=>x.p.method],['Dicatat oleh',x=>x.p.by]],all,'Belum ada pembayaran'))];};

V.stok=()=>{const edit=is('gudang','op','spv'),setup=is('gudang','spv'),which=sel('SKU',S.skus.map(k=>[k.code,k.code+' · '+k.name])),q=h('input',{type:'number',placeholder:'Jumlah','aria-label':'Jumlah'}),ty=sel('Jenis',['Stok masuk','Waste','Cleaning','Koreksi kurang'].map(x=>[x,x]));
 const status=k=>k.stock<0?['Minus, cek fisik','bad']:k.min>0&&k.stock<=k.min?['Pesan lagi','warn']:k.stock===0?['Kosong','warn']:['Aman','ok'];
 const tbl=svc=>table([['SKU',k=>k.code],['Nama',k=>k.name],['Stok',k=>num(k.stock)+' '+k.unit],['Minimum dan pakai per meter',k=>{if(!setup)return num(k.min)+' · '+(k.use==null?'belum diukur':num(k.use)+' '+k.unit);const mn=h('input',{type:'number',min:0,value:k.min,'aria-label':'Minimum '+k.code,style:'width:90px'}),u=h('input',{type:'number',min:0,step:'0.001',value:k.use??'',placeholder:'pakai/m','aria-label':'Pakai per meter '+k.code,style:'width:90px'});return h('div',{class:'row'},mn,u,h('button',{onclick:ev=>act(ev,()=>api('PUT','/api/stock/sku/'+k.code,{min:Number(mn.value)||0,use:u.value===''?null:Number(u.value)}),k.code+' disimpan.')},'Simpan'));}],['Status',k=>h('span',{class:'tag '+status(k)[1]},status(k)[0])]],S.skus.filter(k=>k.svc===svc));
 return[h('h1',{},'SKU dan inventory'),h('p',{class:'muted'},'Isi stok awal dari stock opname lewat Catat mutasi. Pemakaian per meter dipotong otomatis hanya bila sudah diisi. Kain titipan customer tidak masuk stok SDP.'),
 edit?card(h('h2',{},'Catat mutasi'),h('div',{class:'row'},ty,which,q,h('button',{class:'pri',onclick:ev=>{if(!(Number(q.value)>0))return toast('Isi jumlah lebih dari 0.');act(ev,()=>api('POST','/api/stock/move',{sku:which.value,type:ty.value,qty:Number(q.value)}),'Mutasi tersimpan.');}},'Simpan'))):null,
 card(h('h2',{},'Bahan DTF'),tbl('dtf')),card(h('h2',{},'Bahan Sublim'),tbl('sub')),
 card(h('h2',{},'Riwayat mutasi'),table([['Waktu',l=>dt(l.at)],['SKU',l=>l.code],['Jenis',l=>l.type],['Jumlah',l=>(l.qty>0?'+':'')+num(l.qty)],['Sumber',l=>l.ref]],S.ledger,'Belum ada mutasi.'))];};

V.loss=()=>[h('h1',{},'Loss sales dan Log QC (FRM-OPR-005)'),card(table([['Waktu',l=>dt(l.at)],['Order',l=>l.id],['Jenis',l=>l.type],['Alasan',l=>l.reason],['Nilai',l=>l.type==='Reject'?'-':money(l.value)],['Dihitung',l=>l.type==='Reject'?'Mutu':l.count?'Ya':'Tidak']],S.loss,'Belum ada catatan.'))];

V.atur=()=>{const keys=['priceDtf','priceSub120','priceSub160','priceSub180','normDtf','normSubPrint','normPress'],inputs={},f=(k,t)=>lab(t,inputs[k]=h('input',{id:'s-'+k,type:'number',value:S.settings[k]??'',placeholder:'Belum diatur'}));
 return[h('h1',{},'Pengaturan'),card(h('h2',{},'Harga per meter (Rp)'),h('div',{class:'f'},f('priceDtf','DTF maklon'),WIDTHS.map(([k,t])=>f(k,'Sublim, '+t.toLowerCase()))),h('h2',{class:'mt'},'Norma waktu (detik per meter)'),h('div',{class:'f'},f('normDtf','DTF'),f('normSubPrint','Print sublim'),f('normPress','Press')),
 h('div',{class:'mt'},h('button',{class:'pri',onclick:ev=>act(ev,()=>api('PUT','/api/admin/settings',Object.fromEntries(keys.map(k=>[k,inputs[k].value===''?null:Number(inputs[k].value)]))),'Pengaturan tersimpan. Harga baru berlaku untuk order baru.')},'Simpan')),h('p',{class:'small muted'},'Norma DTF 240 detik (4 menit) per meter berasal dari aplikasi DTF Manage Pro.'))];};

V.masuk=()=>{const code=h('input',{id:'u',autocomplete:'username',autocapitalize:'characters'}),pass=h('input',{id:'p',type:'password',autocomplete:'current-password'}),err=h('div',{class:'err',role:'alert'}),go=h('button',{class:'pri big',type:'submit'},'Masuk');
 const form=h('form',{class:'f',onsubmit:async e=>{e.preventDefault();err.replaceChildren();go.disabled=true;go.classList.add('wait');
  try{await api('POST','/api/auth/login',{username:code.value,password:pass.value});}
  catch(x){go.disabled=false;go.classList.remove('wait');err.replaceChildren(h('p',{},x.message),x.network?h('button',{type:'button',onclick:()=>form.requestSubmit()},'Coba Lagi'):'');return;}
  me=null;if(await connect())goto(me.must_change?'akun':home());}},lab('Kode pengguna',code),lab('Password',pass),h('div',{},go));
 return[h('div',{class:'login'},h('div',{class:'card'},h('img',{class:'brand on-light',src:'/logo-light.png',alt:'SDP Print Hub',width:640,height:216}),h('img',{class:'brand on-dark',src:'/logo-dark.png',alt:'SDP Print Hub',width:640,height:216}),h('h1',{},'Masuk SDP'),h('p',{class:'muted'},'Aplikasi internal departemen SDP: DTF dan Sublim.'),form,err))];};

V.akun=()=>{const old=h('input',{id:'old',type:'password',autocomplete:'current-password'}),n1=h('input',{id:'n1',type:'password',autocomplete:'new-password'}),n2=h('input',{id:'n2',type:'password',autocomplete:'new-password'});
 return[h('h1',{},'Akun saya'),card(h('p',{},me.code+' · '+nameOf(me)+' · '+ROLES[me.role]),me.must_change?h('p',{},h('span',{class:'tag warn'},'Password awal wajib diganti sebelum memakai aplikasi')):null),
 h('div',{class:'card login'},h('h2',{},'Ganti password'),h('div',{class:'f'},lab('Password sekarang',old),lab('Password baru (minimal 10 karakter, huruf dan angka)',n1),lab('Ulangi password baru',n2),h('div',{},h('button',{class:'pri',onclick:async()=>{if(n1.value!==n2.value)return toast('Ulangan password tidak sama.');try{await api('POST','/api/auth/change-password',{current_password:old.value,new_password:n1.value});}catch(e){return oops(e);}me=null;S=null;setToken('');if(await connect()){goto('masuk');toast('Password diganti. Silakan masuk dengan password baru.');}}},'Simpan'))))];};

V.pengguna=()=>{const code=h('input',{id:'nu-code'}),name=h('input',{id:'nu-name'}),r=sel('Peran',Object.entries(ROLES),{id:'nu-role'}),store=h('input',{id:'nu-store',placeholder:'khusus Store Head'}),pw=h('input',{id:'nu-pass',type:'password',autocomplete:'new-password'}),reset=h('input',{type:'password','aria-label':'Password reset',placeholder:'Password sementara untuk reset',autocomplete:'new-password',style:'max-width:280px'});r.value='cs';
 const patch=(u,body,msg)=>ev=>act(ev,()=>api('PATCH','/api/admin/users/'+u.id,body()),msg);
 return[h('h1',{},'Pengguna'),card(h('h2',{},'Tambah pengguna'),h('div',{class:'f'},lab('Kode pengguna',code),lab('Nama',name),lab('Peran',r),lab('Toko',store),lab('Password awal (min 10, huruf dan angka)',pw)),h('div',{class:'mt'},h('button',{class:'pri',onclick:ev=>act(ev,()=>api('POST','/api/admin/users',{code:code.value,name:name.value,role:r.value,store:store.value||undefined,password:pw.value}),'Akun dibuat. Password awal wajib diganti saat login pertama.')},'Buat akun'))),
 card(h('div',{class:'row'},reset),table([['Kode',u=>u.code],['Nama',nameOf],['Peran',u=>ROLES[u.role]+(u.store?' · '+u.store:'')],['Status',u=>h('span',{class:'tag '+(u.active?'ok':'bad')},u.active?'Aktif':'Nonaktif')],['Aksi',u=>u.code===me.code?h('span',{class:'muted small'},'Akun Anda'):h('div',{class:'row'},h('button',{onclick:patch(u,()=>({active:!u.active}),'Status akun diubah, sesi dicabut.')},u.active?'Nonaktifkan':'Aktifkan'),h('button',{onclick:patch(u,()=>({new_password:reset.value}),'Password direset, sesi dicabut.')},'Reset password'),h('button',{onclick:ev=>{const nama=prompt('Nama pengguna',nameOf(u));if(nama)patch(u,()=>({name:nama}),'Nama diubah, sesi dicabut.')(ev);}},'Ubah nama'),sel('Peran '+u.code,Object.entries(ROLES),{style:'width:auto',value:u.role,onchange:ev=>patch(u,()=>({role:ev.target.value}),'Peran diubah, sesi dicabut.')(null)}),h('button',{class:'d',onclick:del('/api/manage/users/'+u.id,'Hapus akun '+u.code+'?','Akun dihapus.')},'Hapus'))]],S.users))];};

V.akses=()=>[h('h1',{},'Hak akses'),h('p',{class:'muted'},'Centang menu yang boleh dibuka tiap peran. Master Akun selalu memegang semua menu. Mencabut menu juga mencabut tindakannya. Membuka menu tidak memberi hak tindakan baru: pembayaran dicatat CS dan Store Head; cek file dan produksi oleh Operator dan SPV; QC oleh Operator, QC, atau SPV; persetujuan QC pagi oleh SPV.'),
 card(table([['Menu',k=>PAGES[k]],...STAFF_ROLES.map(r=>[ROLES[r],k=>h('input',{type:'checkbox','aria-label':PAGES[k]+' untuk '+ROLES[r],checked:S.access[r].includes(k),onchange:e=>{const on=e.target.checked,next=on?[...S.access[r],k]:S.access[r].filter(x=>x!==k);if(!next.length){e.target.checked=true;return toast('Setiap peran butuh minimal satu menu.');}act(null,()=>api('PUT','/api/admin/access',{role:r,pages:next}),'Hak akses '+ROLES[r]+' diperbarui.');}})])],GRANTABLE),h('div',{class:'mt'},h('button',{onclick:ev=>act(ev,()=>api('DELETE','/api/admin/access'),'Hak akses kembali ke bawaan.')},'Kembalikan bawaan')))];

let shownPage='';
function render(){
 if(broken)return showFail();
 const parts=location.hash.slice(1).split('/'),ok=allowed();let p=parts[0];
 if(p==='lacak'&&parts[1])trackArg=parts[1];
 if(!ok.includes(p))p=home();
 const out=async()=>{try{await api('POST','/api/auth/logout',{});}catch(e){}me=null;S=null;setToken('');if(await connect()){goto('masuk');toast('Anda sudah keluar.');}};
 document.getElementById('who').replaceChildren(...(me?[h('div',{class:'id'},h('span',{class:'avatar'},icon('user')),h('div',{},h('b',{},nameOf(me)),h('span',{},ROLES[me.role]+' · '+me.code))),h('div',{class:'acts'},S?h('button',{onclick:ev=>act(ev,async()=>{},'Data dimuat ulang.')},icon('refresh'),'Muat ulang'):null,h('button',{onclick:out},icon('logout'),'Keluar'))]
  :[h('div',{class:'id'},h('span',{class:'avatar'},icon('user')),h('div',{},h('b',{},'Belum masuk'))),h('div',{class:'acts'},h('a',{class:'btn',href:'#masuk'},icon('login'),'Masuk'))]));
 document.getElementById('menu').replaceChildren(...GROUPS.flatMap(([title,keys])=>{const ks=keys.filter(k=>ok.includes(k));return ks.length?[h('span',{class:'grp'},title),...ks.map(k=>h('a',{href:'#'+k,'aria-current':k===p?'page':null},icon(PAGE_ICON[k]),PAGES[k]))]:[];}));
 if(p!==shownPage){shownPage=p;const nav=document.getElementById('menu'),on=nav.querySelector('[aria-current]');if(on){const n=nav.getBoundingClientRect(),r=on.getBoundingClientRect();if(r.top<n.top||r.bottom>n.bottom)nav.scrollTop+=r.top-n.top-n.height/2;if(r.left<n.left||r.right>n.right)nav.scrollLeft+=r.left-n.left-12;}}
 try{document.getElementById('view').replaceChildren(...V[p]().flat(Infinity).filter(Boolean));}
 catch(e){console.error(e);document.getElementById('view').replaceChildren(card(h('p',{},'Halaman gagal ditampilkan: '+e.message)));}
}
addEventListener('hashchange',render);
// Mode spreadsheet: file diambil lewat API (setelah cek hak akses), lalu disimpan sebagai unduhan.
document.addEventListener('click',async e=>{const a=e.target.closest&&e.target.closest('a[href^="/api/files/"]');if(!SHEETS||!a)return;e.preventDefault();
 try{const f=await api('GET',a.getAttribute('href'));const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:f.content_type}));const link=h('a',{href:url,download:f.file_name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(x){oops(x);}});
// Penyegaran otomatis hanya di halaman pantauan, agar isian formulir tidak hilang.
setInterval(()=>{if(S&&!broken&&!document.hidden&&['#dashboard','#laporan','#toko'].includes(location.hash))load(true).then(render).catch(e=>netBar('Data belum diperbarui. '+e.message));},30000);
connect();
