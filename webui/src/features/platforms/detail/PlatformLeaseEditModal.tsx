import { useEffect, useId, type FormEvent, type MouseEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { useI18n } from "../../../i18n";

type PlatformLeaseEditModalProps = {
  open: boolean;
  account: string;
  egressIP: string;
  currentEgressIP?: string | null;
  candidateIPs?: string[];
  isLeaseLoading?: boolean;
  areCandidatesLoading?: boolean;
  candidatesLoadFailed?: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onEgressIPChange: (value: string) => void;
  onSubmit: () => void;
};

export function PlatformLeaseEditModal({
  open,
  account,
  egressIP,
  currentEgressIP,
  candidateIPs = [],
  isLeaseLoading = false,
  areCandidatesLoading = false,
  candidatesLoadFailed = false,
  isSaving = false,
  onClose,
  onEgressIPChange,
  onSubmit,
}: PlatformLeaseEditModalProps) {
  const { t } = useI18n();
  const datalistId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-lease-edit-title"
      onClick={handleOverlayClick}
    >
      <Card className="modal-card platform-lease-edit-modal">
        <div className="modal-header">
          <div>
            <h3 id="platform-lease-edit-title">{t("编辑出口 IP")}</h3>
            <p className="platform-lease-edit-description">{t("覆盖当前账号的出口租约，账号字段只读。")}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("关闭")}>
            {t("关闭")}
          </Button>
        </div>

        <form className="form-grid single-column platform-lease-edit-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="platform-lease-edit-account">
              {t("账号")}
            </label>
            <Input id="platform-lease-edit-account" value={account} readOnly />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="platform-lease-edit-egress-ip">
              {t("出口 IP")}
            </label>
            <Input
              id="platform-lease-edit-egress-ip"
              list={datalistId}
              value={egressIP}
              placeholder={t("请输入或选择出口 IP")}
              onChange={(event) => onEgressIPChange(event.target.value)}
              autoFocus
            />
            <datalist id={datalistId}>
              {candidateIPs.map((candidateIP) => (
                <option key={candidateIP} value={candidateIP} />
              ))}
            </datalist>

            {currentEgressIP ? (
              <p className="platform-lease-edit-current">{t("当前值：{{ip}}", { ip: currentEgressIP })}</p>
            ) : null}
            {isLeaseLoading ? <p className="platform-lease-edit-hint">{t("加载租约中...")}</p> : null}
            {areCandidatesLoading ? <p className="platform-lease-edit-hint">{t("加载候选出口中...")}</p> : null}
            {!areCandidatesLoading && candidatesLoadFailed ? (
              <p className="platform-lease-edit-hint platform-lease-edit-hint-error">
                {t("候选出口加载失败，保存时以后端校验为准")}
              </p>
            ) : null}
            {!areCandidatesLoading && !candidatesLoadFailed && candidateIPs.length === 0 ? (
              <p className="platform-lease-edit-hint">{t("暂无可用候选出口")}</p>
            ) : null}
          </div>

          <div className="platform-lease-edit-actions">
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              {t("取消")}
            </Button>
            <Button type="submit" disabled={isSaving || isLeaseLoading}>
              {isSaving ? t("保存中...") : t("保存")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
