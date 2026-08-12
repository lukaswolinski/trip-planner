CREATE TABLE "magic_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "route_legs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile" text NOT NULL,
	"from_lat" numeric(9, 5) NOT NULL,
	"from_lng" numeric(9, 5) NOT NULL,
	"to_lat" numeric(9, 5) NOT NULL,
	"to_lng" numeric(9, 5) NOT NULL,
	"distance_m" integer NOT NULL,
	"duration_s" integer NOT NULL,
	"geometry" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"notes" text,
	"days" integer DEFAULT 0 NOT NULL,
	"profile_to_next" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stops_days_check" CHECK ("stops"."days" >= 0),
	CONSTRAINT "stops_position_check" CHECK ("stops"."position" >= 0),
	CONSTRAINT "stops_lat_check" CHECK ("stops"."lat" between -90 and 90),
	CONSTRAINT "stops_lng_check" CHECK ("stops"."lng" between -180 and 180),
	CONSTRAINT "stops_profile_to_next_check" CHECK ("stops"."profile_to_next" is null or "stops"."profile_to_next" in ('driving', 'walking'))
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"user_id" uuid,
	"title" text DEFAULT 'Untitled trip' NOT NULL,
	"share_slug" text,
	"shared_at" timestamp with time zone,
	"default_profile" text DEFAULT 'driving' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_owner_check" CHECK ("trips"."session_id" is not null or "trips"."user_id" is not null),
	CONSTRAINT "trips_default_profile_check" CHECK ("trips"."default_profile" in ('driving', 'walking'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tier_check" CHECK ("users"."tier" in ('free', 'pro'))
);
--> statement-breakpoint
ALTER TABLE "magic_tokens" ADD CONSTRAINT "magic_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "magic_tokens_expires_at_idx" ON "magic_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "route_legs_key" ON "route_legs" USING btree ("profile","from_lat","from_lng","to_lat","to_lng");--> statement-breakpoint
CREATE INDEX "route_legs_fetched_at_idx" ON "route_legs" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_anon_last_seen_idx" ON "sessions" USING btree ("last_seen_at") WHERE user_id is null;--> statement-breakpoint
CREATE INDEX "stops_trip_id_position_idx" ON "stops" USING btree ("trip_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_share_slug_key" ON "trips" USING btree ("share_slug");--> statement-breakpoint
CREATE INDEX "trips_session_id_idx" ON "trips" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "trips_user_id_idx" ON "trips" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trips_updated_at_idx" ON "trips" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");