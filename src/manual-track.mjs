export function manualTrackFile({name,point}) {
  if(typeof name!=='string'||!name.trim()||name.length>180||/[\\/:*?"<>|\x00-\x1f]/.test(name))throw new Error('Ange ett giltigt spårnamn.');
  if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon)||Math.abs(point.lat)>90||Math.abs(point.lon)>180||point.depth!=null&&(!Number.isFinite(point.depth)||point.depth<0||point.depth>12000))throw new Error('Ogiltig spårpunkt eller djup.');
  return {name:name.trim().replace(/\.csv$/i,'')+'.csv',content:'Datum,Tid,Latitud,Longitud,Fart,Djup\n'+['','',point.lat,point.lon,'',point.depth??''].join(',')+'\n'};
}
