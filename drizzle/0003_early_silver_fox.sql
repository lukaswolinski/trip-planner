CREATE TABLE "itinerary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"start_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_items_position_check" CHECK ("itinerary_items"."position" >= 0),
	CONSTRAINT "itinerary_items_start_minutes_check" CHECK ("itinerary_items"."start_minutes" is null or ("itinerary_items"."start_minutes" >= 0 and "itinerary_items"."start_minutes" < 1440))
);
--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itinerary_items_stop_id_position_idx" ON "itinerary_items" USING btree ("stop_id","position");