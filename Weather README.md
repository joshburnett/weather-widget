# Weather Graph Widget

A medium-size Scriptable iOS widget showing a 4-day weather graph for the device's current location, inspired by the Daily Forecast graph in the Weather Underground app.

## Files

- `scriptable/Weather Graph.js` — the widget script (iCloud-synced to Scriptable)
- `scriptable/Weather screenshot.png` — reference screenshot from the Weather Underground app

## Data Source

Uses the **Open-Meteo** API — free, no API key required.

**Endpoint:** `https://api.open-meteo.com/v1/forecast`

**Parameters used:**

| Parameter | Value | Purpose |
|---|---|---|
| `latitude` / `longitude` | from `Location.current()` | Device GPS location |
| `daily` | `temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset` | Daily hi/lo, totals, day/night boundaries |
| `hourly` | `precipitation_probability,precipitation,weather_code,temperature_2m` | Main graph data |
| `current` | `temperature_2m,precipitation,weather_code` | Current conditions (transition point on graph) |
| `past_days` | `1` | Includes yesterday's hourly data |
| `forecast_days` | `4` | Today + 3 future days (4-day graph window) |
| `timezone` | `auto` | Inferred from coordinates |
| `temperature_unit` | `fahrenheit` | °F |
| `precipitation_unit` | `inch` | Inches |

## Widget Layout

The widget is a single DrawContext image (700×320 canvas, ~2.19:1 aspect ratio to match a medium widget) used as `backgroundImage`. The widget refreshes every 15 minutes.

### Graph time range
- **X axis:** today at midnight → 4 days later (96 hours)
- **Y axis 1 (temperature):** auto-scaled to the hourly temperature range in the window ± 4°F margin
- **Y axis 2 (POP):** always 0–100%, with 100% mapping to the top of the graph area

### Visual layers (bottom to top)

1. **Background** — very light gray (`#f0f0f0`) for daytime hours; slightly darker (`#d8d8d8`) for hours between sunset and sunrise
2. **POP filled area** — trapezoid segments from the bottom of the graph up to the POP curve; **light blue** for rain-type codes, **light purple** for snow-type codes (opacity 0.5)
3. **Decade temperature lines** — horizontal gray dashed lines (1:2 dash:gap ratio) at every 10°F increment visible in the temperature range
4. **Freezing line** — horizontal dark blue dotted line at 32°F, only shown when 32° is within the displayed range
5. **POP stroke** — top edge of the POP area in matching colors at opacity 0.9
6. **Day boundary lines** — thin medium-gray vertical lines at midnight of days 1, 2, and 3 (not at the graph edges)
7. **Actual temperature line** — thin gray line from today midnight to the current time, ending at `current.temperature_2m`
8. **Forecast temperature line** — thin red line starting at the current time/temperature, connected to all future hourly temperature values
9. **High/low circles** — small white-filled circles with red stroke, placed at the hourly index with the daily max and min temperature for each day's future portion
10. **Current-time dot** — solid black circle at the junction of the gray and red temperature lines
11. **Current temperature annotation** — current temperature (e.g. `32°`) in black text, centered over the dot; placed above the dot unless within 5 px of the top edge, in which case it appears below
12. **X-axis minor ticks** — pointing up into the graph at 4 am, 8 am, 12 pm, 4 pm, and 8 pm each day
13. **Bottom axis line**
14. **Day labels** — "TODAY", "MON 9", etc., centered within each day's section (bold)
15. **Hi/lo row** — daily high and low (e.g. `44° | 28°`) below each day label

### Precipitation type detection

WMO weather codes for **snow**: `71, 73, 75, 77, 85, 86`

All other precipitation codes use **rain** colors.

## Location

The widget calls `Location.current()` at kilometer-level accuracy on each refresh. iOS will prompt for location permission the first time the widget runs. If location is unavailable, the widget displays "Location unavailable" instead of the graph.

## Installation

1. The `scriptable/` directory is symlinked to `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/` (or similar Scriptable iCloud path).
2. Changes to `Weather Graph.js` sync automatically to the iPhone via iCloud Drive.
3. On iPhone, open **Scriptable**, find "Weather Graph", and run it to preview.
4. Add a medium iOS widget, choose Scriptable, and select "Weather Graph" as the script.

## Canvas sizing notes

The canvas is `700×320` pixels with `respectScreenScale = false`. When Scriptable scales this to the medium widget frame (~329×150 pt on common iPhones), drawing elements are approximately:

| Canvas px | On-screen pt |
|---|---|
| Font 30 px (day name, bold) | ~14 pt |
| Font 27 px (hi/lo, current temp) | ~12–13 pt |
| Line widths 2.5 px | ~1–1.5 pt |
| Circle radius 7 px (hi/lo) | ~3 pt |
| Circle radius 6 px (current dot) | ~3 pt |

Adjust these constants in the code if elements appear too large or small on a specific device.
