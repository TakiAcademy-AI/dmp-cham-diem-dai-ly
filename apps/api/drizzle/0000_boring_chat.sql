CREATE TABLE "agent_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'DLC' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agent_accounts_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"id_card" text DEFAULT '' NOT NULL,
	"dob" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"tax_code" text DEFAULT '' NOT NULL,
	"bank" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"sale_id" text NOT NULL,
	"tier" text DEFAULT 'member' NOT NULL,
	"tier_protected_until" timestamp with time zone,
	"status" text DEFAULT 'ok' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" text DEFAULT '' NOT NULL,
	"credit_limit" double precision DEFAULT 0 NOT NULL,
	"credit_days" integer DEFAULT 30 NOT NULL,
	"referrer_id" text,
	"app_activated" boolean DEFAULT false NOT NULL,
	"push" text DEFAULT '—' NOT NULL,
	"rank_points" integer DEFAULT 0 NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"pending_points" integer DEFAULT 0 NOT NULL,
	"sales_month" double precision DEFAULT 0 NOT NULL,
	"sales_last_month" double precision DEFAULT 0 NOT NULL,
	"debt" double precision DEFAULT 0 NOT NULL,
	"overdue_days" integer DEFAULT 0 NOT NULL,
	"last_order" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"tax_code" text DEFAULT '' NOT NULL,
	"id_card" text DEFAULT '' NOT NULL,
	"commit_month" double precision DEFAULT 0 NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"policy" text DEFAULT '' NOT NULL,
	"referrer_id" text,
	"docs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage" text NOT NULL,
	"reason" text,
	"agent_id" text,
	"sale_id" text NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent_id" text,
	"title" text NOT NULL,
	"points" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"requested_by" text NOT NULL,
	"requested_role" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"phase" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_name" text NOT NULL,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"old_value" text DEFAULT '—' NOT NULL,
	"new_value" text DEFAULT '—' NOT NULL,
	"ip" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"commit_month" double precision NOT NULL,
	"policy" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Hiệu lực' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gifts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"value" double precision NOT NULL,
	"min_tier" text,
	"stock" integer,
	"window" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Đang mở' NOT NULL,
	"tag" text
);
--> statement-breakpoint
CREATE TABLE "point_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period" text NOT NULL,
	"type" text NOT NULL,
	"fund" text NOT NULL,
	"delta_rank" integer DEFAULT 0 NOT NULL,
	"delta_reward" integer DEFAULT 0 NOT NULL,
	"state" text NOT NULL,
	"item" text NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"rule" text DEFAULT '—' NOT NULL,
	"rule_version" integer,
	"by_user" text NOT NULL,
	"reversal_of" integer,
	"approval_id" text,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monthly_stats" (
	"month" text PRIMARY KEY NOT NULL,
	"ord" integer NOT NULL,
	"revenue" double precision NOT NULL,
	"revenue_ly" double precision NOT NULL,
	"issued" integer NOT NULL,
	"redeemed" integer NOT NULL,
	"active_rate" integer NOT NULL,
	"commit_actual" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text,
	"phone" text,
	"channel" text DEFAULT 'ZNS' NOT NULL,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'Đã gửi' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'KiotViet' NOT NULL,
	"status" text NOT NULL,
	"pay" text NOT NULL,
	"ship" double precision DEFAULT 0 NOT NULL,
	"value" double precision NOT NULL,
	"lines" jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"point_state" text DEFAULT 'none' NOT NULL,
	"tier_at_order" text NOT NULL,
	"rule_version" integer NOT NULL,
	"calc" jsonb,
	"returned_pct" double precision DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"purpose" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"period" text PRIMARY KEY NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "point_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"ledger_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"sku" text PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"line" text NOT NULL,
	"name" text NOT NULL,
	"price" double precision NOT NULL,
	"cost" double precision NOT NULL,
	"no_point" boolean DEFAULT false NOT NULL,
	"multiplier" double precision DEFAULT 1 NOT NULL,
	"multiplier_until" text DEFAULT '' NOT NULL,
	"reg" text DEFAULT '' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"gift_id" text NOT NULL,
	"gift_name" text NOT NULL,
	"points" integer NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"stage" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"pct" double precision NOT NULL,
	"value" double precision NOT NULL,
	"points" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Đã xử lý' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"version" serial PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"params" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"effective_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"two_fa" boolean DEFAULT false NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Đang hoạt động' NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_lots" ADD CONSTRAINT "point_lots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_gift_id_gifts_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."gifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_sale_idx" ON "agents" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "counters_key" ON "counters" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ledger_agent_idx" ON "point_ledger" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ledger_ref_idx" ON "point_ledger" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "orders_agent_idx" ON "orders" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "lots_agent_idx" ON "point_lots" USING btree ("agent_id");