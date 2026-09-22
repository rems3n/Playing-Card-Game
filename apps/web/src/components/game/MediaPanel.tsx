"use client";
import { useEffect, useRef, useState } from "react";
import type { MediaParticipant } from "@card-game/shared-types";
import type { MediaController } from "@/hooks/useMedia";

function Tile({
  person,
  pinned,
  isCurrentPlayer,
  onPin,
  attachVideo,
}: {
  person: MediaParticipant;
  pinned: boolean;
  isCurrentPlayer: boolean;
  onPin: () => void;
  attachVideo: MediaController["attachVideo"];
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || !person.cameraOn) return;
    attachVideo(person.identity, element);
    return () => attachVideo(person.identity, null);
  }, [attachVideo, person.identity, person.cameraOn]);
  const state =
    person.connection === "reconnecting"
      ? "Reconnecting"
      : person.connection === "disconnected"
        ? "Not connected"
        : person.mutedForMe
          ? "Silenced for you"
          : person.microphoneOn
            ? "Microphone on"
            : "Microphone off";
  return (
    <button
      type="button"
      className={`media-tile${pinned ? " pinned" : ""}${person.speaking ? " speaking" : ""}${isCurrentPlayer ? " their-turn" : ""}${person.mutedForMe ? " muted-for-me" : ""}`}
      aria-pressed={pinned}
      aria-label={`${person.displayName}${person.isLocal ? " (you)" : ""}. ${state}. ${pinned ? "Showing large. Select to shrink." : "Select to show large."}`}
      onClick={onPin}
    >
      {person.cameraOn ? (
        <video ref={video} autoPlay playsInline muted={person.isLocal} />
      ) : (
        <span className="media-initial" aria-hidden>
          {person.displayName[0]}
        </span>
      )}
      <span className="media-tile-name">
        {person.displayName}
        {person.isLocal && <small> (you)</small>}
      </span>
      <span className="media-tile-state">
        {person.mutedForMe ? (
          <span aria-hidden title="Silenced for you">
            🚫
          </span>
        ) : person.microphoneOn ? (
          <span aria-hidden title="Microphone on">
            🎙
          </span>
        ) : (
          <span aria-hidden title="Microphone off">
            🔇
          </span>
        )}
        {person.connection !== "connected" && (
          <small>
            {person.connection === "reconnecting" ? "Reconnecting" : "Offline"}
          </small>
        )}
      </span>
    </button>
  );
}

/**
 * Audio and video beside the table.
 *
 * It never sits over the hand, the bidding controls or the next-hand button:
 * on a phone it is a bottom sheet the player opens and closes, and it is closed
 * by default. Every failure shows here and leaves the card game running.
 */
export function MediaPanel({
  media,
  currentPlayerSeat,
  open,
  onOpenChange,
}: {
  media: MediaController;
  currentPlayerSeat: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pinned, setPinned] = useState<string | null>(null);
  const pinnedPerson = media.participants.find((p) => p.identity === pinned);
  const inCall =
    media.status === "connected" ||
    media.status === "connecting" ||
    media.status === "reconnecting";

  if (media.status === "unavailable" && !media.error) return null;

  return (
    <section
      className={`media-panel${open ? " open" : ""}${inCall ? " in-call" : ""}`}
      aria-label="Table call"
      data-status={media.status}
    >
      <div className="media-heading">
        <button
          type="button"
          className="button secondary media-toggle"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          {open ? "Hide call" : inCall ? "Show call" : "Call"}
          {inCall && media.participants.length > 0 && (
            <span className="media-count" aria-hidden>
              {media.participants.length}
            </span>
          )}
        </button>
        {open && (
          <p className="media-status" role="status">
            {media.status === "connected"
              ? `${media.participants.length} in the call`
              : media.status === "connecting"
                ? "Joining the call…"
                : media.status === "reconnecting"
                  ? "Reconnecting to the call…"
                  : media.status === "unavailable"
                    ? "Calls are not available on this server"
                    : media.status === "failed"
                      ? "The call is not connected"
                      : "You are not in the call"}
          </p>
        )}
      </div>
      {open && (
        <div className="media-body">
          {media.error && (
            <p className="notice media-error" role="alert">
              {media.error} You can keep playing.{" "}
              <button type="button" onClick={media.dismissError}>
                Dismiss
              </button>
            </p>
          )}
          {inCall ? (
            <>
              {media.audioBlocked && (
                <button
                  type="button"
                  className="button primary media-unblock"
                  onClick={media.startAudio}
                >
                  Turn on sound
                </button>
              )}
              <div className="media-tiles">
                {media.participants.map((person) => (
                  <Tile
                    key={person.identity}
                    person={person}
                    pinned={pinned === person.identity}
                    isCurrentPlayer={person.seatIndex === currentPlayerSeat}
                    onPin={() =>
                      setPinned((current) =>
                        current === person.identity ? null : person.identity,
                      )
                    }
                    attachVideo={media.attachVideo}
                  />
                ))}
                {media.participants.length === 0 && (
                  <p className="media-empty">
                    Nobody else has joined the call yet.
                  </p>
                )}
              </div>
              <div className="media-controls">
                <button
                  type="button"
                  className="button secondary"
                  aria-pressed={media.microphoneOn}
                  onClick={media.toggleMicrophone}
                >
                  {media.microphoneOn ? "Mute" : "Unmute"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  aria-pressed={media.cameraOn}
                  onClick={media.toggleCamera}
                >
                  {media.cameraOn ? "Camera off" : "Camera on"}
                </button>
                {media.audioOutputs.length > 1 && (
                  <label className="media-output">
                    <span>Sound out</span>
                    <select
                      value={media.audioOutput}
                      onChange={(event) =>
                        media.selectAudioOutput(event.target.value)
                      }
                    >
                      <option value="">Default</option>
                      {media.audioOutputs.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="button secondary media-leave"
                  onClick={media.leave}
                >
                  Leave call
                </button>
              </div>
              {pinnedPerson && !pinnedPerson.isLocal && (
                <button
                  type="button"
                  className="button secondary media-mute-one"
                  aria-pressed={pinnedPerson.mutedForMe}
                  onClick={() => media.toggleMutedForMe(pinnedPerson.identity)}
                >
                  {pinnedPerson.mutedForMe
                    ? `Hear ${pinnedPerson.displayName} again`
                    : `Silence ${pinnedPerson.displayName} for me`}
                </button>
              )}
              <p className="media-note">
                Leaving the call keeps your seat at the table.
              </p>
            </>
          ) : (
            <div className="media-controls">
              <button
                type="button"
                className="button primary"
                disabled={media.status === "unavailable"}
                onClick={media.join}
              >
                Join the call
              </button>
              <p className="media-note">
                Your microphone and camera start off.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
