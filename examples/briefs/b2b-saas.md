# Tracejam — distributed tracing for Kafka pipelines

Developer tool. We ingest OpenTelemetry spans out of Kafka consumer groups and
reconstruct end-to-end traces across topics, so an SRE can see where a message
actually stalled instead of guessing from consumer lag.

Audience is platform engineers who already run Grafana and do not want another
dashboard. The differentiator is topic-level span stitching — nobody else
correlates across rebalances.

Site needs: the request/response of the ingest API, a real terminal transcript of
the CLI, self-hosting instructions, and honest pricing per ingested gigabyte. Our
customers are sceptical of marketing sites, so no invented benchmarks and no
logo wall we have not earned.

Tone: cool, precise, instrument-panel. Code as the hero.
