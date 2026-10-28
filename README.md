# Minecraft on-demand @ AWS

Your world, when you want to play.

A private Minecraft Java server for friends, with a simple website to get
everyone into the game. Built for evenings of exploring, building, and picking
up where you left off — without keeping a game server running around the clock.

## Less setup. More Minecraft.

- **Sign in without a password.** Approved players receive a code by email.
- **Start your world from the browser.** Watch its status while it gets ready.
- **Copy the address and join.** No AWS console needed for players.
- **Find the right mods.** One list with Modrinth searches for the installed mods.
- **Save your Minecraft username.** Set up your account for server access and
  update it when your name changes.

This is a personal project for a private group, not a public hosting service.

## A little about the build

Runs on AWS using Amazon ECS with EC2 capacity, with infrastructure managed
through AWS CDK. The lightweight web portal is hosted on GitHub Pages.

Deployment details live in the [setup guide](docs/setup.md).
