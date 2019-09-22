# How to run

running the project should output a summary of the FARGATE tasks running in your cluster
```
PROFILE=prod make run
## outputs something like:
{
  serviceName: 'total',
  desiredCount: 155,
  runningCount: 155,
  pendingCount: 0,
  launchType: 'FARGATE'
}
```