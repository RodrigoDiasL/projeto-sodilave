"use client";
import { useEffect, useState } from "react";
import { FeedbackForm } from "@/components/FeedbackForm";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { saveStorageLocation,removeStorageLocation,addOpeningStock } from "@/app/actions/storage-admin";
import { productionUnitLabel } from "@/lib/production-unit";
type Position={id:number;warehouseCode:string;warehouseName:string;zoneType:string;rowNumber:number;columnNumber:number;code:string;active:boolean};
type Product={id:number;code:string;name:string;productionUnit:string;unitsPerPackage:number};
export function StorageAdmin({locations,products,machines}:{locations:Position[];products:Product[];machines:{id:number;code:string;name:string}[]}){
  const [requestId,setRequestId]=useState("");const [quantity,setQuantity]=useState("");
  useEffect(()=>setRequestId(crypto.randomUUID()),[]);
  const saveOpening=async(fd:FormData)=>{const result=await addOpeningStock(fd);if(result.ok){setRequestId(crypto.randomUUID());setQuantity("");}return result;};
  const [selected,setSelected]=useState("");const current=locations.find(l=>String(l.id)===selected);
  const [productId,setProductId]=useState("");const product=products.find(p=>String(p.id)===productId);
  return <div className="form-stack">
    <section className="panel form-stack"><h2>Posições do armazém</h2><label>Adicionar / editar posição<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Nova posição</option>{locations.map(l=><option key={l.id} value={l.id}>{l.warehouseName} · {l.zoneType==="PALLET"?"Palete":"Estiba"} · {l.code}{!l.active?" (removida)":""}</option>)}</select></label>
      <FeedbackForm key={JSON.stringify(current??null)} action={saveStorageLocation} className="form-stack" successMessage="Posição guardada.">
        {current&&<input type="hidden" name="id" value={current.id}/>}
        <div className="two-col"><label>Código do armazém<input name="warehouseCode" defaultValue={current?.warehouseCode??"W1"} maxLength={8} required/></label><label>Nome do armazém<input name="warehouseName" defaultValue={current?.warehouseName??"Armazém 1"} maxLength={64} required/></label><label>Tipo<select name="zoneType" defaultValue={current?.zoneType??"STACK"}><option value="STACK">Estiba / monte</option><option value="PALLET">Posição de paletes</option></select></label><label>Código da posição<input name="code" defaultValue={current?.code??""} maxLength={16} placeholder="Ex.: A1 ou P-A1" required/></label><label>Linha no mapa<input name="rowNumber" type="number" min="1" max="100" defaultValue={current?.rowNumber??1} required/></label><label>Coluna no mapa<input name="columnNumber" type="number" min="1" max="30" defaultValue={current?.columnNumber??1} required/></label></div>
        <button className="btn primary">{current?(current.active?"Guardar posição":"Reativar posição"):"Adicionar posição"}</button>
      </FeedbackForm>
      {current?.active&&<FeedbackForm action={removeStorageLocation} successMessage="Posição removida do mapa."><input type="hidden" name="id" value={current.id}/><ConfirmDeleteButton label="Remover posição" message="Remover esta posição do mapa? Só é possível se estiver vazia e sem saídas por regularizar."/></FeedbackForm>}
    </section>
    <section className="panel form-stack"><h2>Dar entrada de stock inicial</h2><p>Registe as quantidades que já existiam antes da app. Não exige arranque, verificações ou mistura; não soma aos contadores de produção nem consome matérias-primas. Use o código de lote que consta nas embalagens. Pode repetir o mesmo lote em várias entradas e posições; cada entrada acrescenta apenas a quantidade indicada.</p>
      <FeedbackForm action={saveOpening} className="form-stack" successMessage="Stock inicial registado e disponível no mapa e nas saídas."><input type="hidden" name="requestId" value={requestId}/><div className="two-col"><label>Produto<select name="productId" value={productId} onChange={e=>setProductId(e.target.value)} required><option value="">Selecione</option>{products.map(p=><option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label><label>Máquina de origem<select name="machineId" required defaultValue=""><option value="">Selecione</option>{machines.map(m=><option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</select></label><label>Código do lote existente<input name="lotCode" maxLength={120} required/></label><label>Quantidade ({productionUnitLabel(product?.productionUnit??"BAG",2)})<input name="quantityPackages" value={quantity} onChange={e=>setQuantity(e.target.value)} type="number" min="1" max="10000000" step="1" required/></label><label>Posição no armazém<select name="locationId" required defaultValue=""><option value="">Selecione</option>{locations.filter(l=>l.active).map(l=><option key={l.id} value={l.id}>{l.warehouseName} · {l.code}</option>)}</select></label></div>{product&&<p>Cada {productionUnitLabel(product.productionUnit,1)} corresponde a {product.productionUnit==="UNIT"?1:product.unitsPerPackage} artigo(s).</p>}<label>Observações<textarea name="notes" maxLength={500}/></label><button className="btn primary" disabled={!requestId}>Registar stock inicial</button></FeedbackForm>
    </section>
  </div>;
}
