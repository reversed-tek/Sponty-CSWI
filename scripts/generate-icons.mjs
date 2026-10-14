/* Deterministically generate compatible PNGs without native dependencies. */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
function crc(data) {
  let result=0xffffffff;
  for(const byte of data){result^=byte;for(let i=0;i<8;i++)result=(result>>>1)^((result&1)?0xedb88320:0);}
  return (result^0xffffffff)>>>0;
}
function chunk(type,data) {
  const tag=Buffer.from(type,'ascii');
  const size=Buffer.alloc(4);size.writeUInt32BE(data.length);
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc(Buffer.concat([tag,data])));
  return Buffer.concat([size,tag,data,checksum]);
}
function png(n) {
  const raw=Buffer.alloc(n*(n*4+1));const scale=n/64;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const i=y*(n*4+1)+1+x*4;
    const px=x/scale,py=y/scale;
    let c=[39,71,102];
    const bar=(px>16&&px<46&&py>19&&py<24)||(px>16&&px<38&&py>29&&py<34)||(px>16&&px<31&&py>39&&py<44);
    const badge=((px-44)*(px-44)+(py-43)*(py-43)<110);
    const check=(Math.abs((py-44)-(px-42))<1.8&&px>38&&px<44)||(Math.abs((py-45)+(px-45)*1.1)<1.8&&px>=43&&px<51);
    if(bar)c=[255,255,255];
    if(badge)c=[207,228,251];
    if(badge&&check)c=[39,71,102];
    raw[i]=c[0];raw[i+1]=c[1];raw[i+2]=c[2];raw[i+3]=255;
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(n,0);ihdr.writeUInt32BE(n,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
mkdirSync('public/icons',{recursive:true});
for(const size of [16,32,64,80,128]) writeFileSync('public/icons/icon-'+size+'.png',png(size));
console.log('Generated Outlook PNG icon assets.');
