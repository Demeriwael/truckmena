import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
  divIcon,
  latLngBounds,
  type Marker as LeafletMarker,
  type LeafletKeyboardEvent,
} from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { Crosshair, Flag, MapPinned, Route, Truck } from "lucide-react";
import type { TripEvent, TripPlan } from "@/lib/contracts";
import { durationLabel, eventTime } from "@/lib/format";
import { eventLabels, statusLabels, eventSymbols } from "@/lib/event-presentation";
import type { EventSelection } from "@/lib/plan-view";
import { Button } from "./ui/button";

function MapViewport({ plan }: { plan: TripPlan | null }) {
  const map = useMap();
  useEffect(() => {
    if (plan)
      map.fitBounds(latLngBounds(plan.route.geometry), {
        padding: [45, 55],
        maxZoom: 12,
        animate: false,
      });
  }, [map, plan]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      if (plan)
        map.fitBounds(latLngBounds(plan.route.geometry), {
          padding: [32, 40],
          maxZoom: 12,
          animate: false,
        });
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, plan]);
  return (
    <div className="map-fit-control">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={plan ? "Fit map to route" : "Reset map view"}
        title="Fit map to route"
        onClick={() =>
          plan
            ? map.fitBounds(latLngBounds(plan.route.geometry), {
                padding: [45, 55],
                maxZoom: 12,
                animate: false,
              })
            : map.setView([38.5, -97.5], 4, { animate: false })
        }
      >
        <Crosshair size={18} />
      </Button>
    </div>
  );
}

function EventMarker({
  event,
  offset,
  selection,
  onSelect,
  hoveredId,
  onHover,
}: {
  event: TripEvent;
  offset: number;
  selection: EventSelection | null;
  onSelect: (id: string) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}) {
  const ref = useRef<LeafletMarker>(null);
  const map = useMap();
  const position = useMemo<[number, number]>(
    () => [event.lat, event.lng],
    [event.lat, event.lng],
  );
  const handlers = useMemo(
    () => ({
      click: () => onSelect(event.id),
      keydown: (input: LeafletKeyboardEvent) => {
        if (input.originalEvent.key === "Enter" || input.originalEvent.key === " ") {
          input.originalEvent.preventDefault();
          onSelect(event.id);
        }
      },
      mouseover: () => onHover(event.id),
      mouseout: () => onHover(null),
    }),
    [event.id, onSelect, onHover],
  );
  const icon = useMemo(
    () =>
      divIcon({
        className: "event-marker",
        iconSize: [32, 32],
        iconAnchor: [16 - offset, 16],
        popupAnchor: [offset, -20],
        // All HTML here is static; addresses and provider notes render as React text.
        html: `<span class="marker-badge marker-${event.type}">${eventSymbols[event.type]}</span>`,
      }),
    [event.type, offset],
  );
  useEffect(() => {
    // Keep the icon DOM stable during pointer input. Replacing it on mouseover
    // can remove the pressed element before mouseup and swallow marker clicks.
    const element = ref.current?.getElement();
    element?.classList.toggle("marker-selected", selection?.id === event.id);
    element?.classList.toggle("marker-hovered", hoveredId === event.id);
  }, [event.id, hoveredId, selection, icon]);
  useEffect(() => {
    if (selection?.id === event.id) {
      if (selection.source === "itinerary")
        map.panTo([event.lat, event.lng], { animate: false });
      ref.current?.openPopup();
    } else ref.current?.closePopup();
  }, [selection, event.id, event.lat, event.lng, map]);
  return (
    <Marker
      ref={ref}
      position={position}
      icon={icon}
      title={`${eventLabels[event.type]}: ${event.place}`}
      alt={`${eventLabels[event.type]}: ${event.place}`}
      eventHandlers={handlers}
    >
      <Popup>
        <div className="event-popup">
          <span className={`popup-kind marker-text-${event.type}`}>
            {eventLabels[event.type]}
          </span>
          <h3>{event.place}</h3>
          <p className="popup-time">{eventTime(event.start)}</p>
          <dl>
            <div>
              <dt>Duration</dt>
              <dd>{durationLabel(event.duration_min)}</dd>
            </div>
            <div>
              <dt>Duty status</dt>
              <dd>{statusLabels[event.status]}</dd>
            </div>
            <div>
              <dt>Route position</dt>
              <dd>
                {event.mile_marker.toLocaleString("en-US", {
                  maximumFractionDigits: 1,
                })}{" "}
                mi
              </dd>
            </div>
          </dl>
          <p className="popup-note">{event.note}</p>
        </div>
      </Popup>
    </Marker>
  );
}

export function RouteMap({
  plan,
  dirty,
  pending,
  selection,
  hoveredId,
  onSelect,
  onHover,
}: {
  plan: TripPlan | null;
  dirty: boolean;
  pending: boolean;
  selection: EventSelection | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const [tileError, setTileError] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(true);
  const stops = plan?.events.filter((event) => event.type !== "driving") ?? [];
  // Driving rows use the API's start coordinate. No fabricated positions for
  // midnight continuations; their rows and popups refer to the full event.
  const activeDriving =
    plan?.events.filter(
      (event) =>
        event.type === "driving" &&
        (event.id === hoveredId || event.id === selection?.id),
    ) ?? [];
  const seen = new Map<string, number>();
  const markerOffsets = stops.map((event) => {
    const key = `${event.lat.toFixed(6)},${event.lng.toFixed(6)}`;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return index === 0 ? 0 : Math.ceil(index / 2) * 26 * (index % 2 ? 1 : -1);
  });
  return (
    <section
      className={`map-card ${plan ? "map-with-results" : ""}`}
      aria-labelledby="map-title"
      aria-busy={pending}
    >
      <div className="map-heading">
        <div>
          <span className="eyebrow">THE ROAD AHEAD</span>
          <h2 id="map-title">Route overview</h2>
        </div>
        <span className={`map-state ${plan ? "map-state-ready" : ""}`}>
          <span />
          {plan ? `${stops.length} stops positioned` : "Ready when you are"}
        </span>
      </div>
      <div className="map-canvas">
        <MapContainer
          center={[38.5, -97.5]}
          zoom={4}
          minZoom={2}
          scrollWheelZoom={false}
          zoomControl={true}
          className="leaflet-map"
        >
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            eventHandlers={{
              loading: () => setTilesLoading(true),
              load: () => setTilesLoading(false),
              tileerror: () => {
                setTileError(true);
                setTilesLoading(false);
              },
            }}
          />
          <MapViewport plan={plan} />
          {plan && (
            <>
              <Polyline
                positions={plan.route.geometry}
                pathOptions={{ color: "#fff", weight: 8, opacity: 0.95 }}
              />
              <Polyline
                positions={plan.route.geometry}
                pathOptions={{ color: "#2563eb", weight: 4, opacity: 1 }}
              />
              {stops.map((event, index) => (
                <EventMarker
                  key={event.id}
                  event={event}
                  offset={markerOffsets[index] ?? 0}
                  selection={selection}
                  onSelect={onSelect}
                  hoveredId={hoveredId}
                  onHover={onHover}
                />
              ))}
              {activeDriving.map((event, index) => (
                <EventMarker
                  key={event.id}
                  event={event}
                  offset={-26 * (index + 1)}
                  selection={selection}
                  onSelect={onSelect}
                  hoveredId={hoveredId}
                  onHover={onHover}
                />
              ))}
            </>
          )}
        </MapContainer>
        {!plan && (
          <div className="map-empty">
            <span className="empty-route-icon">
              <MapPinned size={28} />
            </span>
            <h3>Your next trip starts here</h3>
            <p>
              Enter your route to see the miles ahead,
              <br />
              with every required stop along the way.
            </p>
            <div className="empty-route-steps">
              <span>
                <Truck size={14} />
                Start
              </span>
              <i />
              <span>Pickup</span>
              <i />
              <span>
                <Flag size={14} />
                Delivery
              </span>
            </div>
          </div>
        )}
        {tilesLoading && !tileError && (
          <span className="tiles-status" role="status">
            Loading map…
          </span>
        )}
        {tileError && (
          <div className="map-tile-warning" role="status">
            Map tiles are unavailable. You can still plan a trip and view its route and
            stops.
          </div>
        )}
        {dirty && (
          <div className="map-stale" role="status">
            Trip details changed. Plan again to update this map.
          </div>
        )}
      </div>
      <div className="map-footer">
        <div className="map-legend" aria-label="Map marker legend">
          <span>
            <i className="legend-start" />
            Start
          </span>
          <span>
            <i className="legend-pickup" />
            Pickup
          </span>
          <span>
            <i className="legend-dropoff" />
            Delivery
          </span>
          <span>
            <i className="legend-fuel" />
            Fuel
          </span>
          <span>
            <i className="legend-break" />
            Break
          </span>
          <span>
            <i className="legend-rest" />
            Rest
          </span>
          <span>
            <i className="legend-restart" />
            Restart
          </span>
        </div>
        <p>
          <Route size={13} />
          {plan
            ? plan.route.provider === "ors"
              ? `Truck route · ${plan.route.attribution.join(" · ")}`
              : `Fallback car route · ${plan.route.attribution.join(" · ")}`
            : "Your route and required stops will appear here"}
        </p>
      </div>
      {plan && (
        <details className="map-stops">
          <summary>
            View map stops <span>{stops.length}</span>
          </summary>
          <div>
            {stops.map((event) => (
              <button
                type="button"
                key={event.id}
                onClick={() => onSelect(event.id)}
                onMouseEnter={() => onHover(event.id)}
                onMouseLeave={() => onHover(null)}
              >
                <span className={`stop-symbol marker-${event.type}`}>
                  {eventSymbols[event.type]}
                </span>
                <span>
                  <strong>{eventLabels[event.type]}</strong>
                  {event.place}
                </span>
                <span className="stop-open">View on map</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
