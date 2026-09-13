// A spatial hierarchy keeps overview rendering and viewport counts independent
// of total point count. Representatives preserve the shallowest raw depth.
export function buildPointIndex(points) {
  function build(indices, depth=0) {
    let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity,min=Infinity,max=-Infinity,sample=indices[0]
    for(const i of indices) { const p=points[i]; west=Math.min(west,p.lon);east=Math.max(east,p.lon);south=Math.min(south,p.lat);north=Math.max(north,p.lat);if(p.depth<min){min=p.depth;sample=i}max=Math.max(max,p.depth) }
    const node={west,east,south,north,min,max,sample,count:indices.length}
    if(indices.length<=64 || depth>=24 || (west===east && south===north)) { node.indices=indices;return node }
    const mx=(west+east)/2,my=(south+north)/2,groups=[[],[],[],[]]
    for(const i of indices) {const p=points[i];groups[(p.lon>mx?1:0)+(p.lat>my?2:0)].push(i)}
    node.children=groups.filter(g=>g.length).map(g=>build(g,depth+1)); return node
  }
  return {points,root:points.length ? build(points.map((_,i)=>i)) : null}
}
const outside=(n,b)=>n.east<b.west||n.west>b.east||n.north<b.south||n.south>b.north
const contained=(n,b)=>n.west>=b.west&&n.east<=b.east&&n.south>=b.south&&n.north<=b.north
export function countPoints(index,bounds,inside=null) {
  function visit(n) {
    if(!n||outside(n,bounds))return 0
    if(contained(n,bounds) && (!inside || [[n.west,n.south],[n.east,n.south],[n.east,n.north],[n.west,n.north]].every(([lon,lat])=>inside({lon,lat}))))return n.count
    if(n.children)return n.children.reduce((s,c)=>s+visit(c),0)
    return n.indices.reduce((s,i)=>{const p=index.points[i];return s+(p.lon>=bounds.west&&p.lon<=bounds.east&&p.lat>=bounds.south&&p.lat<=bounds.north&&(!inside||inside(p))?1:0)},0)
  }
  return visit(index.root)
}
export function viewPoints(index,bounds,longitudeStep,latitudeStep) {
  const result=[]
  function visit(n) {
    if(!n||outside(n,bounds))return
    if(n.east-n.west<=longitudeStep && n.north-n.south<=latitudeStep && contained(n,bounds)) { result.push(n.sample);return }
    if(n.children) {for(const c of n.children)visit(c);return}
    const cells=new Map()
    for(const i of n.indices){const p=index.points[i];if(p.lon<bounds.west||p.lon>bounds.east||p.lat<bounds.south||p.lat>bounds.north)continue;const key=Math.floor(p.lon/longitudeStep)+':'+Math.floor(p.lat/latitudeStep);const old=cells.get(key);if(old===undefined||p.depth<index.points[old].depth)cells.set(key,i)}
    result.push(...cells.values())
  }
  visit(index.root)
  return result.sort((a,b)=>a-b).map(i=>({point:index.points[i],index:i}))
}
