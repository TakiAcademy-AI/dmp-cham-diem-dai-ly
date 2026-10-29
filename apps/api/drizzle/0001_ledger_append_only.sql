-- Sổ cái điểm chỉ ghi thêm: chặn DELETE, chặn UPDATE mọi cột trừ chuyển trạng thái Treo → Khả dụng/Thu hồi.
CREATE OR REPLACE FUNCTION point_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'point_ledger là sổ chỉ ghi thêm: không được xoá dòng %', OLD.id;
  END IF;
  IF NEW.delta_rank <> OLD.delta_rank OR NEW.delta_reward <> OLD.delta_reward OR NEW.agent_id <> OLD.agent_id
     OR NEW.type <> OLD.type OR NEW.fund <> OLD.fund OR NEW.period <> OLD.period OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'point_ledger là sổ chỉ ghi thêm: không được sửa dòng % (dùng bút toán đảo)', OLD.id;
  END IF;
  IF NEW.state <> OLD.state AND NOT (OLD.state = 'pending' AND NEW.state IN ('available', 'revoked')) THEN
    RAISE EXCEPTION 'point_ledger: chỉ được chuyển trạng thái pending → available/revoked (dòng %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER point_ledger_append_only BEFORE UPDATE OR DELETE ON point_ledger
  FOR EACH ROW EXECUTE FUNCTION point_ledger_guard();
