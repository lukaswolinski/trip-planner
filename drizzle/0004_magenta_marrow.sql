CREATE TABLE "expense_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"share_cents" integer NOT NULL,
	CONSTRAINT "expense_shares_amount_check" CHECK ("expense_shares"."share_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_by_member_id" uuid,
	"spent_on" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "trip_members_role_check" CHECK ("trip_members"."role" in ('owner', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "budget_total_cents" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "budget_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_member_id_trip_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."trip_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_member_id_trip_members_id_fk" FOREIGN KEY ("paid_by_member_id") REFERENCES "public"."trip_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_expense_member_key" ON "expense_shares" USING btree ("expense_id","member_id");--> statement-breakpoint
CREATE INDEX "expense_shares_expense_id_idx" ON "expense_shares" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "expenses_trip_id_idx" ON "expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_members_trip_email_key" ON "trip_members" USING btree ("trip_id","email");--> statement-breakpoint
CREATE INDEX "trip_members_trip_id_idx" ON "trip_members" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_members_user_id_idx" ON "trip_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trip_members_email_idx" ON "trip_members" USING btree ("email");