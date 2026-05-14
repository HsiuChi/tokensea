import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/services/api"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Search } from "lucide-react"

export function PricingPage() {
  const { t } = useTranslation()
  const [models, setModels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [category] = useState("all")

  useEffect(() => {
    api.getPublicModels().then(setModels).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = models.filter((m: any) => {
    const matchSearch = !search || (m.displayName || m.alias).toLowerCase().includes(search.toLowerCase())
    const matchCategory = category === "all" || true
    return matchSearch && matchCategory
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pricing.title")}</h1>
        <p className="text-muted-foreground">{t("pricing.subtitle")}</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")} className="pl-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pricing.model")}</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">{t("pricing.inputPrice")}</TableHead>
                  <TableHead className="text-right">{t("pricing.outputPrice")}</TableHead>
                  <TableHead className="text-right">{t("pricing.contextWindow")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.displayName || m.alias}</TableCell>
                    <TableCell><Badge variant="secondary">{m.provider}</Badge></TableCell>
                    <TableCell className="text-right text-sm">¥{m.inputPrice ?? "—"}{t("pricing.per1mTokens")}</TableCell>
                    <TableCell className="text-right text-sm">¥{m.outputPrice ?? "—"}{t("pricing.per1mTokens")}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{m.maxContext ? `${(m.maxContext / 1000).toFixed(0)}K` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
