export function productionToInitial(production: any, cavityData?: any, cavityTests: any[] = []) {
  const testMap = new Map(production.tests.map((test: any) => [`${test.type}_${test.moment}`, test.result]));
  const cavityTestMap = new Map(cavityTests.map((test: any) => [`${test.type}_${test.moment}`, test.result]));
  return {
    id: production.id,
    machineId: production.machineId,
    productId: production.productId,
    productionLot: production.productionLot,
    initialWeightG: production.initialWeightG ? String(Number(production.initialWeightG)) : "",
    midWeightG: production.midWeightG ? String(Number(production.midWeightG)) : "",
    rightInitialWeightG: cavityData?.rightInitialWeightG ? String(Number(cavityData.rightInitialWeightG)) : "",
    rightMidWeightG: cavityData?.rightMidWeightG ? String(Number(cavityData.rightMidWeightG)) : "",
    quantityProduced: production.quantityProduced === null ? "" : String(production.quantityProduced),
    observations: production.observations ?? "",
    exceptionReason: production.exceptionReason ?? "",
    exceptionNotes: production.exceptionNotes ?? "",
    totalMaterialKg: production.materials.length ? String(production.materials.reduce((sum: number, material: any) => sum + Number(material.quantityKg ?? 0), 0)) : "",
    materials: production.materials.map((material: any, index: number) => ({
      key: material.id || index,
      materialId: String(material.rawMaterialLot.rawMaterialId),
      lotId: String(material.rawMaterialLotId),
      percentage: Number(material.percentage ?? 0),
      quantityKg: material.quantityKg ? String(Number(material.quantityKg)) : "",
    })),
    tests: {
      leakStart: testMap.get("LEAK_START") ?? "",
      leakMid: testMap.get("LEAK_MID") ?? "",
      dropStart: testMap.get("DROP_START") ?? "",
      dropMid: testMap.get("DROP_MID") ?? "",
      leakStartRight: cavityTestMap.get("LEAK_START") ?? "",
      leakMidRight: cavityTestMap.get("LEAK_MID") ?? "",
      dropStartRight: cavityTestMap.get("DROP_START") ?? "",
      dropMidRight: cavityTestMap.get("DROP_MID") ?? "",
    },
  };
}

export function previousProductionToDefaults(production:any){
  const availableMaterials=production.materials.filter((material:any)=>material.rawMaterialLot.status==="ACTIVE"&&Number(material.rawMaterialLot.quantityAvailable)>0);
  return {
    machineId:production.machineId,
    productId:production.productId,
    productionLot:"",
    initialWeightG:"",
    midWeightG:"",
    rightInitialWeightG:"",
    rightMidWeightG:"",
    quantityProduced:"",
    observations:"",
    exceptionReason:"",
    exceptionNotes:"",
    totalMaterialKg:"",
    materials:availableMaterials.map((material:any,index:number)=>({
      key:-(production.id*10+index+1),
      materialId:String(material.rawMaterialLot.rawMaterialId),
      lotId:String(material.rawMaterialLotId),
      percentage:Number(material.percentage??0),
      quantityKg:"",
      manualQuantity:false,
    })),
    tests:{},
    inheritedFromPreviousShift:true,
  };
}
