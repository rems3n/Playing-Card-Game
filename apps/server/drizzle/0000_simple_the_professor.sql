CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_order_check" CHECK ("friendships"."user_a_id" < "friendships"."user_b_id")
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"event_type" varchar(30) NOT NULL,
	"player_seat" integer,
	"payload" jsonb NOT NULL,
	"sequence_num" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid,
	"seat_position" integer NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"ai_difficulty" varchar(20),
	"ai_persona" varchar(50),
	"final_score" integer,
	"rating_before" real,
	"rating_after" real
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_type" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"config" jsonb NOT NULL,
	"final_scores" jsonb,
	"winner_seat" integer,
	"winner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"game_type" varchar(20) NOT NULL,
	"config" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"game_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_type" varchar(20) NOT NULL,
	"rating" real NOT NULL,
	"recorded_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_type" varchar(20) NOT NULL,
	"rating" real DEFAULT 1500 NOT NULL,
	"rating_deviation" real DEFAULT 350 NOT NULL,
	"volatility" real DEFAULT 0.06 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(50) NOT NULL,
	"avatar_url" text,
	"auth_provider" varchar(20) NOT NULL,
	"auth_provider_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_unique" ON "friendships" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "game_events_game_seq_idx" ON "game_events" USING btree ("game_id","sequence_num");--> statement-breakpoint
CREATE UNIQUE INDEX "game_players_seat_unique" ON "game_players" USING btree ("game_id","seat_position");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_history_unique" ON "rating_history" USING btree ("user_id","game_type","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_user_game_unique" ON "ratings" USING btree ("user_id","game_type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_unique" ON "users" USING btree ("auth_provider","auth_provider_id");