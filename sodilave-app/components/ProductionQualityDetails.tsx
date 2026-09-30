import {isCapMachine,isDualCavityMachine} from "@/lib/machine-icon";
const n=(v:unknown)=>v==null?"—":Number(v).toLocaleString("pt-PT",{maximumFractionDigits:3});
const label=(s:string)=>({CONFORMING:"Conforme",NON_CONFORMING:"Não conforme",NOT_PERFORMED:"Não realizado",NOT_APPLICABLE:"Não aplicável"}[s]??s);
function Quality({title,initial,mid,tests}:{title:string;initial:unknown;mid:unknown;tests:any[]}){return <section className="subpanel"><h3>{title}</h3><p><b>Peso inicial:</b> {n(initial)} g</p><p><b>Peso a meio:</b> {n(mid)} g</p>{tests.map(t=><p key={`${t.type}-${t.moment}`}><b>{t.type==="LEAK"?"Vedação":"Queda"} · {t.moment==="START"?"Início":"Meio"}:</b> {label(t.result)}</p>)}</section>;}
export function ProductionQualityDetails({production,cavity,testsRight=[]}:{production:any;cavity?:any;testsRight?:any[]}){
 const p=production;
 if(isCapMachine(p.machine.code))return <section className="subpanel"><h3>Produção de tampas</h3><p><b>Produzido:</b> {n(p.producedKg)} kg</p><p><b>Cor:</b> {p.productionColor||"—"}</p><p><b>Acondicionamento:</b> {p.capPackaging==="BOX"?"Caixas":p.capPackaging==="BIN"?"Caixotes":"Não registado no formato antigo"}</p></section>;
 return <div className={isDualCavityMachine(p.machine.code)?"two-col":"form-stack"}><Quality title={isDualCavityMachine(p.machine.code)?"Cavidade esquerda":"Pesos e testes"} initial={p.initialWeightG} mid={p.midWeightG} tests={p.tests??[]}/>{isDualCavityMachine(p.machine.code)&&<Quality title="Cavidade direita" initial={cavity?.rightInitialWeightG} mid={cavity?.rightMidWeightG} tests={testsRight}/>}</div>;
}
