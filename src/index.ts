import {fargateCount, ServiceStatus} from './fargateCount';

export function printReport() {
  fargateCount()
    .then( (summary) => {
      console.log(summary);
    })
    .catch( (err) => console.log(err));
  
}

printReport();