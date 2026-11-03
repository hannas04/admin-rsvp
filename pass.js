/* pass.js — draws the guest gate pass as a PNG on a canvas */
const EVENT={couple:"Emma & Lucas",date:"Saturday, 17 July 2027",time:"11:00 AM",place:"Lagos, Nigeria",planner:"Planned by Ever After Events"};

async function makePass(r){
  try{await Promise.all([document.fonts.load('700 40px "Playfair Display"'),document.fonts.load('600 20px Montserrat')])}catch(e){}
  const W=800,H=1250,c=document.createElement('canvas');c.width=W;c.height=H;
  const x=c.getContext('2d');x.textAlign='center';
  const T=(t,y,font,col,ls)=>{x.font=font;x.fillStyle=col;x.letterSpacing=ls||'0px';x.fillText(t,W/2,y)};

  // background + card
  const g=x.createLinearGradient(0,0,W,H);
  g.addColorStop(0,'#ffc2d9');g.addColorStop(.5,'#ee6fa0');g.addColorStop(1,'#c2275f');
  x.fillStyle=g;x.fillRect(0,0,W,H);
  x.fillStyle='#fffafb';x.beginPath();x.roundRect(40,40,W-80,H-80,28);x.fill();
  x.strokeStyle='#f1c5d6';x.lineWidth=2;x.beginPath();x.roundRect(60,60,W-120,H-120,20);x.stroke();

  // header
  T('WEDDING PASS',130,'600 24px Montserrat, sans-serif','#d6407a','6px');
  T(EVENT.couple,215,'700 58px "Playfair Display", Georgia, serif','#2a1620','1px');
  T(EVENT.date+' · '+EVENT.time,270,'500 24px Montserrat, sans-serif','#6b4a58','1px');
  T(EVENT.place,305,'500 22px Montserrat, sans-serif','#6b4a58','1px');

  // guest name (shrinks if long)
  const nm=r.name.toUpperCase();let fs=46;x.letterSpacing='0px';
  while(fs>22){x.font=`700 ${fs}px "Playfair Display", Georgia, serif`;if(x.measureText(nm).width<W-200)break;fs-=2}
  T(nm,390,`700 ${fs}px "Playfair Display", Georgia, serif`,'#8f1f4c','2px');
  const total=1+(r.plus_ones||0);
  T(total===1?'Admits 1 guest':`Admits ${total} guests (guest + ${r.plus_ones})`,440,'500 24px Montserrat, sans-serif','#6b4a58','1px');

  // QR code (contains the ticket code)
  const q=qrcode(0,'M');q.addData(r.ticket_code);q.make();
  const n=q.getModuleCount(),cell=Math.floor(440/n),size=cell*n,ox=(W-size)/2,oy=510;
  x.fillStyle='#fff';x.fillRect(ox-28,oy-28,size+56,size+56);
  x.strokeStyle='#f1c5d6';x.lineWidth=2;x.strokeRect(ox-28,oy-28,size+56,size+56);
  x.fillStyle='#2a1620';
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(q.isDark(i,j))x.fillRect(ox+j*cell,oy+i*cell,cell,cell);

  // footer
  T(r.ticket_code,oy+size+85,'600 34px Montserrat, sans-serif','#2a1620','8px');
  T('Present this QR code at the gate',oy+size+135,'500 22px Montserrat, sans-serif','#d6407a','2px');
  T(EVENT.planner,H-115,'500 20px Montserrat, sans-serif','#6b4a58','2px');
  return c;
}