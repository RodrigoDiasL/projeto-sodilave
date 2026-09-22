import { requireUser } from "@/lib/auth";
import { PageIntro } from "@/components/PageIntro";
import { StockMap } from "@/components/StockMap";
import { getStorageLocations, getStorageMapData, getUnlocatedFinishedLots } from "@/lib/stock-map";

export default async function StockMapPage() {
  const user = await requireUser();
  const [locations, allLocations, unlocated] = await Promise.all([
    getStorageMapData(),
    getStorageLocations(),
    user.role === "ADMIN" ? getUnlocatedFinishedLots() : Promise.resolve([]),
  ]);

  return <>
    <PageIntro
      title="Mapa de Stock"
      subtitle="Localização física dos lotes de produto acabado nos armazéns, estibas e zonas de paletes."
    />
    <div className="notice">
      Cada célula representa uma posição física. Uma posição pode conter vários lotes. As quantidades são controladas em sacos; nos artigos produzidos diretamente em paletes, a mesma lógica é aplicada em paletes.
    </div>
    <StockMap locations={locations} allLocations={allLocations} unlocated={unlocated} isAdmin={user.role === "ADMIN"}/>
  </>;
}
