import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-6 py-12">
          <h1 className="text-7xl font-bold tracking-tighter text-muted-foreground">404</h1>
          <p className="text-xl text-muted-foreground">{t("common.pageNotFound")}</p>
          <Button asChild>
            <Link to="/app">{t("common.backToDashboard")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
