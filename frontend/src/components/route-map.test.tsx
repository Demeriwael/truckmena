import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import type { DivIcon, Marker as LeafletMarker, LeafletKeyboardEvent } from "leaflet";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripPlanSchema } from "@/lib/contracts";
import type { EventSelection } from "@/lib/plan-view";
import fixture from "@/test/fixtures/trip.json";
import { RouteMap } from "./route-map";

const mocks = vi.hoisted(() => ({
  panTo: vi.fn(),
  fitBounds: vi.fn(),
  openPopup: vi.fn(),
  closePopup: vi.fn(),
}));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    panTo: mocks.panTo,
    fitBounds: mocks.fitBounds,
    getContainer: () => document.body,
    invalidateSize: () => {},
    setView: () => {},
  }),
  Marker: forwardRef<
    LeafletMarker,
    {
      title: string;
      icon: DivIcon;
      eventHandlers: {
        click: () => void;
        mouseover: () => void;
        mouseout: () => void;
        keydown: (input: LeafletKeyboardEvent) => void;
      };
      children: ReactNode;
    }
  >(({ title, icon, eventHandlers, children }, ref) => {
    const element = useRef<HTMLButtonElement>(null);
    useImperativeHandle(
      ref,
      () =>
        ({
          openPopup: () => mocks.openPopup(title),
          closePopup: () => mocks.closePopup(title),
          getElement: () => element.current,
        }) as unknown as LeafletMarker,
      [title],
    );
    return (
      <div>
        <button
          ref={element}
          type="button"
          aria-label={title}
          data-icon={icon.options.html}
          onClick={eventHandlers.click}
          onMouseEnter={eventHandlers.mouseover}
          onMouseLeave={eventHandlers.mouseout}
          onKeyDown={(input) =>
            eventHandlers.keydown({
              originalEvent: input.nativeEvent,
            } as LeafletKeyboardEvent)
          }
        >
          Marker
        </button>
        {children}
      </div>
    );
  }),
}));
const plan = tripPlanSchema.parse(fixture);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("map event synchronization", () => {
  it("opens and reopens an itinerary-selected event at the API coordinate", () => {
    const selection: EventSelection = { id: "event-0002", source: "itinerary" };
    const props = {
      plan,
      dirty: false,
      pending: false,
      hoveredId: null,
      onSelect: vi.fn(),
      onHover: vi.fn(),
    };
    const { rerender } = render(<RouteMap {...props} selection={selection} />);
    expect(mocks.panTo).toHaveBeenLastCalledWith([1, 1], { animate: false });
    expect(mocks.openPopup).toHaveBeenLastCalledWith("Pickup: Pickup");
    const initial = mocks.openPopup.mock.calls.length;
    rerender(<RouteMap {...props} selection={{ ...selection }} />);
    expect(mocks.openPopup.mock.calls.length).toBe(initial + 1);
    mocks.closePopup.mockClear();
    rerender(<RouteMap {...props} selection={null} />);
    expect(mocks.closePopup).toHaveBeenCalledWith("Pickup: Pickup");
  });
  it("notifies the itinerary when a map marker is selected or hovered", () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    render(
      <RouteMap
        plan={plan}
        dirty={false}
        pending={false}
        selection={null}
        hoveredId={null}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
    const marker = screen.getByRole("button", { name: "Pickup: Pickup" });
    fireEvent.mouseEnter(marker);
    expect(onHover).toHaveBeenLastCalledWith("event-0002");
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith("event-0002");
    fireEvent.mouseLeave(marker);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
  it("keeps the selected driving point visible while another driving event is hovered", () => {
    const { rerender } = render(
      <RouteMap
        plan={plan}
        dirty={false}
        pending={false}
        selection={{ id: "event-0001", source: "itinerary" }}
        hoveredId={null}
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Driving: Current" })).toHaveClass(
      "marker-selected",
    );
    rerender(
      <RouteMap
        plan={plan}
        dirty={false}
        pending={false}
        selection={{ id: "event-0001", source: "itinerary" }}
        hoveredId="event-0003"
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Driving: Current" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Driving: Pickup" })).toHaveClass(
      "marker-hovered",
    );
    expect(screen.getByText("3 stops positioned")).toBeInTheDocument();
  });
  it.each(["Enter", " "])(
    "synchronizes keyboard activation with %j and prevents page scrolling",
    (key) => {
      const onSelect = vi.fn();
      render(
        <RouteMap
          plan={plan}
          dirty={false}
          pending={false}
          selection={null}
          hoveredId={null}
          onSelect={onSelect}
          onHover={() => {}}
        />,
      );
      const marker = screen.getByRole("button", { name: "Pickup: Pickup" });
      expect(fireEvent.keyDown(marker, { key })).toBe(false);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith("event-0002");
    },
  );
});
