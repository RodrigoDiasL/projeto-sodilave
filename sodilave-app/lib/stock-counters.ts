import { db } from "@/lib/db";
import { getUnlocatedFinishedLots } from "@/lib/stock-map";

export async function getStockCounters() {
  const [products, balances, unlocated] = await Promise.all([
    db.product.findMany({orderBy:{name:"asc"}}),
    db.query<any[]>(`SELECT p.productId,l.warehouseName,SUM(b.quantityPackages*COALESCE(p.unitsPerPackageSnapshot,pr.unitsPerPackage,0)) AS units
      FROM ProductionStorageBalance b JOIN Production p ON p.id=b.productionId JOIN Product pr ON pr.id=p.productId
      JOIN StorageLocation l ON l.id=b.locationId
      WHERE p.status='FINALIZED' AND p.recordOrigin<>'HISTORICAL_IMPORT' AND b.quantityPackages>0
      GROUP BY p.productId,l.warehouseName ORDER BY l.warehouseName`),
    getUnlocatedFinishedLots(),
  ]);
  const articles = products.map(product=>{
    const warehouses=balances.filter(row=>Number(row.productId)===product.id).map(row=>({name:String(row.warehouseName),units:Number(row.units)}));
    const located=warehouses.reduce((sum,row)=>sum+row.units,0);
    const unlocatedUnits=unlocated.filter(row=>row.productId===product.id).reduce((sum,row)=>sum+row.missingPackages*row.unitsPerPackage,0);
    return {id:product.id,name:String(product.name),code:String(product.code),family:String(product.stockFamily??"").trim(),active:Boolean(product.active),located,unlocated:unlocatedUnits,total:located+unlocatedUnits,warehouses};
  }).filter(row=>row.active||row.total>0);
  const families=new Map<string,{name:string;total:number;located:number;unlocated:number}>();
  for(const article of articles){
    if(!article.family)continue;
    const key=article.family.toLocaleLowerCase("pt-PT");
    const family=families.get(key)??{name:article.family,total:0,located:0,unlocated:0};
    family.total+=article.total;family.located+=article.located;family.unlocated+=article.unlocated;families.set(key,family);
  }
  return {articles,families:[...families.values()]};
}
