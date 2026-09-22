ALTER TABLE "game_players" ADD COLUMN "participant_id" uuid;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "display_name" varchar(60);--> statement-breakpoint
CREATE INDEX "game_players_participant_idx" ON "game_players" USING btree ("participant_id");