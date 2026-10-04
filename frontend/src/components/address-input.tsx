import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, MapPin, X } from "lucide-react";
import { autocomplete } from "@/lib/api";
import type { Location } from "@/lib/contracts";
import { useDebounced } from "@/hooks/use-debounced";
import { Input } from "./ui/input";

interface AddressInputProps {
  label: string;
  placeholder: string;
  kind: "current" | "pickup" | "delivery";
  value: Location;
  onChange: (value: Location) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
  error?: string;
}

export function AddressInput({
  label,
  placeholder,
  kind,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
}: AddressInputProps) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  useImperativeHandle(inputRef, () => input.current!, []);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const query = useDebounced(value.label.trim());
  const selected = value.lat !== undefined;
  const suggestions = useQuery({
    queryKey: ["addresses", query],
    queryFn: ({ signal }) => autocomplete(query, signal),
    enabled:
      focused &&
      !dismissed &&
      !selected &&
      query.length >= 3 &&
      query === value.label.trim(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  const open = focused && !dismissed && !selected && value.label.trim().length >= 3;
  const options = query === value.label.trim() ? (suggestions.data ?? []) : [];
  useEffect(() => {
    const option = document.getElementById(`${id}-option-${active}`);
    const container = popover.current;
    if (!open || !option || !container) return;
    const item = option.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
    else if (item.top < bounds.top) container.scrollTop += item.top - bounds.top;
  }, [active, id, open]);
  const choose = (location: Location) => {
    onChange(location);
    setDismissed(true);
    setActive(-1);
  };

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setDismissed(true);
      setActive(-1);
      return;
    }
    // Home/End remain native text-editing keys until an option is active.
    // Modified arrow keys also belong to the input's text cursor.
    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !selected &&
      (["ArrowDown", "ArrowUp"].includes(event.key) ||
        (open && active >= 0 && ["Home", "End"].includes(event.key))) &&
      options.length
    ) {
      event.preventDefault();
      setDismissed(false);
      setActive((index) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % options.length
              : index <= 0
                ? options.length - 1
                : index - 1,
      );
    }
    if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      choose(options[active]);
    }
  }

  return (
    <div className="address-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="address-control">
        <span className={`location-dot location-dot-${kind}`} aria-hidden="true" />
        <Input
          id={id}
          ref={input}
          value={value.label}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={open && options.length ? `${id}-options` : undefined}
          aria-activedescendant={
            open && options[active] ? `${id}-option-${active}` : undefined
          }
          aria-invalid={Boolean(error)}
          aria-required="true"
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          autoComplete="off"
          maxLength={300}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => {
            setFocused(false);
            onBlur();
          }}
          onChange={(event) => {
            onChange({ label: event.target.value });
            setActive(-1);
            setDismissed(false);
          }}
          onKeyDown={keyDown}
        />
        {suggestions.isFetching && open ? (
          <LoaderCircle
            className="address-status spin"
            size={16}
            aria-label="Finding addresses"
          />
        ) : selected ? (
          <Check
            className="address-status selected-address"
            size={16}
            aria-label="Location selected"
          />
        ) : null}
        {value.label && (
          <button
            type="button"
            className="clear-address"
            aria-label={`Clear ${label.toLowerCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange({ label: "" });
              setActive(-1);
              setDismissed(false);
              input.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <span id={`${id}-help`} className="sr-only">
        Enter at least three characters for suggestions. Use the up and down arrows to
        choose, Enter to select, or Escape to close. A full address can also be
        submitted directly.
      </span>
      {open && options.length > 0 && (
        <span className="sr-only" role="status">
          {options.length} address suggestions available. Use the up and down arrows to
          choose.
        </span>
      )}
      {open && (
        <div className="suggestions-popover" ref={popover}>
          {options.length > 0 ? (
            <div
              id={`${id}-options`}
              role="listbox"
              aria-label={`${label} suggestions`}
            >
              {options.map((option, index) => (
                <div
                  key={`${option.lat}-${option.lng}-${index}`}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`suggestion ${index === active ? "suggestion-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <MapPin size={16} aria-hidden="true" />
                  <span>{option.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="suggestion-message" role="status">
              {suggestions.isError
                ? "Suggestions unavailable. Enter a full address or use the sample trip."
                : suggestions.isFetching || query !== value.label.trim()
                  ? "Finding addresses…"
                  : "No suggestions found. You can still submit a full address."}
            </p>
          )}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
