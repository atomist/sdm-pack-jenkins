# @atomist/sdm-pack-jenkins

[![npm version](https://img.shields.io/npm/v/@atomist/sdm-pack-jenkins.svg)](https://www.npmjs.com/package/@atomist/sdm-pack-jenkins)

An extension Pack for an Atomist SDM to integrate with Jenkins for 
converging Job definitions and triggering jobs/build/pipelines as part
of an Atomist SDM goal set.

// add link to sample

Software delivery machines enable you to control your delivery process
in code.  Think of it as an API for your software delivery.  See the
[Atomist documentation][atomist-doc] for more information on the
concept of a software delivery machine and how to create and develop
an SDM.

[atomist-doc]: https://docs.atomist.com/ (Atomist Documentation)

## Getting started

See the [Developer Quick Start][atomist-quick] to jump straight to
creating an SDM.

[atomist-quick]: https://docs.atomist.com/quick-start/ (Atomist - Developer Quick Start)

## Contributing

Contributions to this project from community members are encouraged
and appreciated. Please review the [Contributing
Guidelines](CONTRIBUTING.md) for more information. Also see the
[Development](#development) section in this document.

## Code of conduct

This project is governed by the [Code of
Conduct](CODE_OF_CONDUCT.md). You are expected to act in accordance
with this code by participating. Please report any unacceptable
behavior to code-of-conduct@atomist.com.

## Documentation

Please see [docs.atomist.com][atomist-doc] for
[developer][atomist-doc-sdm] documentation.

[atomist-doc-sdm]: https://docs.atomist.com/developer/sdm/ (Atomist Documentation - SDM Developer)

## Connect

Follow [@atomist][atomist-twitter] and [The Composition][atomist-blog]
blog related to SDM.

[atomist-twitter]: https://twitter.com/atomist (Atomist on Twitter)
[atomist-blog]: https://the-composition.com/ (The Composition - The Official Atomist Blog)

## Support

General support questions should be discussed in the `#support`
channel in the [Atomist community Slack workspace][slack].

If you find a problem, please create an [issue][].

[issue]: https://github.com/atomist-seeds/sdm-pack/issues

## Development

You will need to install [Node.js][node] to build and test this
project.

[node]: https://nodejs.org/ (Node.js)

### Build and test

Install dependencies.

```
$ npm install
```

Use the `build` package script to compile, test, lint, and build the
documentation.

```
$ npm run build
```

### Release

Releases are handled via the [Atomist SDM][atomist-sdm].  Just press
the 'Approve' button in the Atomist dashboard or Slack.

[atomist-sdm]: https://github.com/atomist/atomist-sdm (Atomist Software Delivery Machine)

---

Created by [Atomist][atomist].
Need Help?  [Join our Slack workspace][slack].

[atomist]: https://atomist.com/ (Atomist - How Teams Deliver Software)
[slack]: https://join.atomist.com/ (Atomist Community Slack)