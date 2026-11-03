# Roku MCP server

Controls a Roku through the Roku External Control Protocol (ECP), from Claude Code or any MCP client. It is also the
TV half of [JARVIS for Alexa](../../docs/jarvis-alexa.md), which calls it directly over stdio.

- **No dependencies.** One file, `server.mjs`, on Node 18 or later (tested on Node 20).
- **MCP stdio transport.** The client starts it as a child process. It opens no listening port.
- **LAN only.** It refuses any address that is not private (10/8, 172.16/12, 192.168/16 or 169.254/16).
- **Self-healing address.** If the Roku stops answering and `ROKU_SERIAL` is set, it searches the LAN with SSDP for
  that serial number and switches to the address it finds.

## Register

```
claude mcp add --scope user roku -e ROKU_IP=<roku-lan-ip> -e ROKU_SERIAL=<serial> -- node /path/to/server.mjs
```

| Env | Meaning |
|---|---|
| `ROKU_IP` | The Roku's LAN address. |
| `ROKU_PORT` | The ECP port. Default 8060. |
| `ROKU_TIMEOUT_MS` | Timeout per request. Default 4000. |
| `ROKU_SERIAL` | Optional. Lets SSDP rediscovery find this Roku if DHCP moves it. |

## Tools

| Tool | What it does |
|---|---|
| `roku_status` | Checks the Roku is reachable and shows what is on screen. |
| `roku_device_info` | Model, software, network and power mode. `full: true` returns every raw field. |
| `roku_list_apps` | The installed apps and their IDs, read live from the Roku. |
| `roku_launch_app` | Launches an app by fuzzy name or ID, with optional deep link (`contentId`, `mediaType`), and confirms it came to the front. |
| `roku_power` | `on`, `off` or `toggle`. |
| `roku_volume` | `up` or `down` with optional `steps`, or `mute`. |
| `roku_playback` | `play_pause`, `fast_forward` or `rewind` (each with optional `times`), or `instant_replay`. |
| `roku_navigate` | `home`, `back`, arrows, `select`, `info`, `search` or `backspace`, with optional `times`. |
| `roku_type_text` | Types into the on-screen keyboard or search box. |
| `roku_send_commands` | Runs steps in order (`{key, times}`, `{launch}`, `{text}`, `{wait_ms}`) and stops at the first failure. |
| `roku_discover` | Finds Rokus on the LAN with SSDP; `use_ip` switches to one for this session. |

App IDs are never hard-coded; they are looked up from the device each time. Errors explain the likely cause (a
timeout points to the Roku being off, a changed IP or Wi-Fi client isolation; HTTP 403 points to the "Control by
mobile apps" setting).

## Test

```
ROKU_IP=<roku-lan-ip> node test.mjs        # status, Home, status
node test.mjs roku_launch_app '{"app":"hulu"}' roku_navigate '{"action":"home"}'
```

`test.mjs` drives the server over MCP stdio, the same way Claude Code does. Verified on a real Roku streaming stick:
Home, launching YouTube, Disney+ and Netflix (each read back as the active app), a multi-step sequence, a Spotify
playlist deep link, and the error paths (unknown key, app not installed, ambiguous name, unreachable IP, public IP
refused).

## Limits of a streaming stick

A stick is not a Roku TV: power and volume reach the TV only through HDMI-CEC, and the Roku cannot report whether the
TV obeyed. Play and pause are one toggle key in ECP. Input and channel keys apply only to Roku TVs.
