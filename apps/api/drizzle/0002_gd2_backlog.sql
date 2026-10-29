CREATE TABLE "agent_monthly" (
	"agent_id" text NOT NULL,
	"month" text NOT NULL,
	"sales" double precision NOT NULL,
	"commit" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"value" double precision NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"from_date" timestamp with time zone NOT NULL,
	"to_date" timestamp with time zone NOT NULL,
	"budget" integer DEFAULT 0 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Nháp' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"ledger_id" integer,
	"ref" text DEFAULT '' NOT NULL,
	"tx_label" text DEFAULT '' NOT NULL,
	"claim" text NOT NULL,
	"want_points" integer DEFAULT 0 NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'Mới' NOT NULL,
	"assignee" text,
	"resolution" text,
	"approval_id" text,
	"due_at" timestamp with time zone NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"method" text DEFAULT 'quiz' NOT NULL,
	"approval_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"rule" text DEFAULT 'R07' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"file_id" text,
	"quiz" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pass_pct" integer DEFAULT 80 NOT NULL,
	"status" text DEFAULT 'Đang mở' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"category" text NOT NULL,
	"points" integer NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"stage" text NOT NULL,
	"approval_id" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"path" text NOT NULL,
	"owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"status" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"method" text DEFAULT 'Chuyển khoản' NOT NULL,
	"source" text DEFAULT 'Thủ công' NOT NULL,
	"by_user" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"kind" text DEFAULT 'file' NOT NULL,
	"size_label" text DEFAULT '' NOT NULL,
	"file_id" text,
	"url" text DEFAULT '' NOT NULL,
	"min_tier" text,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'Chờ gửi' NOT NULL,
	"sender" text NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tier_history" (
	"month" text PRIMARY KEY NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD COLUMN "consent_device" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "doc_files" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "doc_files" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "image_file_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "sender" text DEFAULT 'Hệ thống' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_amount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "campaign_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_monthly_pk" ON "agent_monthly" USING btree ("agent_id","month");--> statement-breakpoint
CREATE INDEX "attempts_course_idx" ON "course_attempts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job");--> statement-breakpoint
CREATE INDEX "payments_agent_idx" ON "payments" USING btree ("agent_id");