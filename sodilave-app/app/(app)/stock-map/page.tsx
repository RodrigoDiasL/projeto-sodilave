import { StockCounters } from "@/components/StockCounters";
import { getStockCounters } from "@/lib/stock-counters";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { StockMap } from "@/components/StockMap";
import { getStorageLocations, getStorageMapData, getUnlocatedFinishedLots } from "@/lib/stock-map";

export default async function StockMapPage() {
  const user = await requireUser();
  const [locations, allLocations, unlocated, counters] = await Promise.all([
    getStorageMapData(),
    getStorageLocations(),
    user.role === "ADMIN" ? getUnlocatedFinishedLots() : Promise.resolve([]),
    getStockCounters(),
  ]);

  return <>
    <PageIntro
      title="Mapa de Stock"
      subtitle="Localização física dos lotes de produto acabado nos armazéns, estibas e zonas de paletes."
    />
    {user.role === "ADMIN" && <Link className="btn primary" href="/admin/storage">Gerir armazém e stock inicial</Link>}
    <div className="notice">
      Cada célula representa uma posição física. Uma posição pode conter vários lotes. As quantidades são controladas em sacos, paletes ou unidades, conforme a configuração do produto.
    </div>
    <StockCounters data={counters}/>
    <StockMap locations={locations} allLocations={allLocations} unlocated={unlocated} isAdmin={user.role === "ADMIN"}/>
  </>;
}
