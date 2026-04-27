import { Card } from "@/components/ui/Card";

export default function AccessDeniedPage() {
  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <h1 className="mb-2 text-lg font-medium text-sell">Access denied</h1>
        <p className="text-sm text-text-muted">
          Your Google account is not on the allowlist for this DM instance.
          Ask the owner to add your email to <code>ALLOWED_EMAILS</code>.
        </p>
      </Card>
    </div>
  );
}
