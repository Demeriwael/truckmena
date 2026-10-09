# Wayline providers

Routing and geocoding are backend services. The [planner](../backend/trips/services/planner.py) resolves locations, requests a route, schedules HOS events, positions them on the route, and builds log sheets. HOS calculation does not depend on provider travel-time estimates.

## Routing and address search

| Service                | Use                                                                                                | Limits and fallback behavior                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| OpenRouteService (ORS) | Primary `driving-hgv` routing, address autocomplete/search, and optional reverse-place enrichment. | Requires a backend key. Transport, quota, authentication, or malformed-response failures can trigger the applicable fallback. |
| OSRM                   | Route fallback using its car profile.                                                              | Cannot verify truck height, weight, or road restrictions. Every fallback plan identifies OSRM and includes a warning.         |
| Nominatim              | Optional fallback for full addresses submitted with Plan trip when ORS lookup fails.               | Disabled by default. Never used for autocomplete or batches of route reverse lookups.                                         |

ORS receives one directions request containing current, pickup, and delivery coordinates. The request uses GeoJSON with instructions enabled because ORS otherwise omits the per-leg distance segments. Turn steps are discarded during parsing and are not cached or returned to the frontend. An ORS no-route result is a client error, not an instruction to silently substitute a car route.

Provider distances feed exact fractional engine miles; driving duration is scheduled at 55 mph. The API retains provider travel duration only as reference information. A haversine index scales geometry independently to each leg's provider distance, keeping pickup at the correct waypoint even when polyline length differs from reported mileage.

Frontend autocomplete waits 350 ms, requires three characters, and treats cached suggestions as fresh for five minutes. Inactive cached queries are garbage-collected after 30 minutes. Editing a selected address removes its old coordinates. Complete addresses may still be submitted if suggestions fail. Submitted coordinates bypass address lookup, so the sample can plan without an ORS key using OSRM with its warning.

## Caching and request limits

Django's local-memory cache is bounded to 4,096 entries. Cache keys hash normalized queries or coordinates with the relevant provider URLs. Cache and request pacing are per process.

| Result or gate                                    | Policy                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| Successful ORS routes and geocodes                | Cached for 24 hours.                                                |
| ORS transport, quota, and authentication failures | A 30-second cooldown avoids repeated failing requests.              |
| OSRM fallback routes                              | Cached for 60 seconds so ORS can be retried sooner.                 |
| Missing reverse-place results                     | Cached for 60 seconds.                                              |
| Public OSRM requests                              | Serialized with at least 1.1 seconds between starts in one process. |
| Optional Nominatim searches                       | Serialized with at least 1.1 seconds between starts in one process. |
| ORS reverse-place requests                        | At most four starts per second, with contention skipped.            |

Reverse enrichment has a per-trip budget of eight lookups and a three-second window for starting them. Repeated places share a lookup, and known current/pickup/delivery labels need none. An in-flight lookup can exceed that window until its timeout. Failed, contended, or unattempted enrichment uses `Mile N on route` and does not invalidate a route.

HTTP calls use 3.05-second connect and 12-second read timeouts, with no redirects or retries and an 8 MiB response ceiling. Corrupt legs over 100,000 km or one year of provider travel time are rejected before scheduling. These bounds are not a guarantee of total end-to-end request time.

Implementation: [HTTP and request gates](../backend/trips/services/providers.py), [routing and geometry](../backend/trips/services/routing.py), [geocoding](../backend/trips/services/geocoding.py), and [cache configuration](../backend/config/settings.py).

## Optional public Nominatim

The [public Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) forbids autocomplete, requires application identification and attribution, limits the whole application to one request per second, and discourages bulk use. Wayline restricts this fallback to user-submitted full-address searches.

To enable it for a small demo:

1. Read the policy and set `NOMINATIM_ENABLED=true` in `backend/.env` or the backend host's environment settings.
2. Set `GEOCODING_USER_AGENT` to identify the application and provide a project/contact URL, for example `Wayline (https://example.com/contact)`. Replace the example URL with an actual contact URL.
3. Run one worker on one replica. Multiple processes or replicas require shared pacing/cache coordination, or a suitable self-hosted/commercial service.
4. Retain route/provider attribution in results. `ORS_BASE_URL`, `OSRM_BASE_URL`, and `NOMINATIM_BASE_URL` allow service changes without code edits.

Keep Nominatim disabled if those conditions cannot be met. Shared coordination and provider quotas also need review before scaling other public-provider use. The process-local limits do not coordinate separate deployments.

## Credentials, privacy, and attribution

`ORS_API_KEY` belongs only in `backend/.env` or backend hosting secrets. ORS requests use an authorization header, keeping the key out of query strings. Never put credentials in a `VITE_` variable; frontend API-origin configuration is public.

Address and coordinate requests necessarily reach the selected public providers. Do not submit confidential addresses to them. Public errors omit upstream messages, URLs, and credentials; unexpected errors log only the exception class. See the [safe error handler](../backend/trips/exceptions.py).

The API supplies `route.attribution`; the map displays provider attribution alongside OpenStreetMap attribution. Leaflet requests visible OpenStreetMap tiles using normal browser caching. Tile access is separate from backend routing and follows the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Verification and references

Automated tests make no external provider requests and require no key. They cover parsing, caching, fallback paths, policy gates, safe errors, event placement, and API-to-HOS integration. Live checks are separate and must not be reported as test-suite results; dated evidence is kept in [Deployment](DEPLOYMENT.md#verification-record).

Provider references: [ORS directions](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types), [ORS geocoder](https://giscience.github.io/openrouteservice/api-reference/endpoints/geocoder/), [OSRM API](https://project-osrm.org/docs/v5.24.0/api/), and [OSRM demo server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).

[Back to README](../README.md)
