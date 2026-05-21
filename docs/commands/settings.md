# settings

Edit, read, set, or reset persisted default settings.

## Usage

```sh
repovista settings
repovista settings get [key]
repovista settings set <key> <value>
repovista settings reset [key]
```

## Examples

```sh
repovista settings
repovista settings get
repovista settings get model
repovista settings set model gpt-5.5
repovista settings set reasoning xhigh
repovista settings set fastMode on
repovista settings set exportFormats sarif,html
repovista settings reset reasoning
repovista settings reset
```

## Storage

Settings are stored in `~/.config/repovista/settings.json` unless `REPOVISTA_CONFIG` points to another file.

## Reference

See [Settings keys](../reference/settings.md) for every key and accepted type.
