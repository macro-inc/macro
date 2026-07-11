# Unfurling Service

To run locally:

```
just run
```

To test:

```
just test
```

To unfurl:

First, make sure the serve is running with something like `just run`, then:

```
$ just unfurl https://macro.com
{
  "url": "https://macro.com",
  "title": "Macro | Home",
  "description": "Macro - the next generation productivity suite",
  "image_url": "https://macro.com/logo.png",
  "favicon_url": "https://macro.com/favicon.ico"
}
```

Build the docker image:

```
just docker-build
```

Run the docker image:

```
just docker-run
```
