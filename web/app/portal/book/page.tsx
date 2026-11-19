import RequestForm from '@/components/RequestForm';

export const metadata = { title: 'Book a slot · Performance Slots' };

/** Participant booking: same form and same database tables as Request slots, but phone is mandatory. */
export default function PortalBook() {
  return (
    <RequestForm endpoint="/api/portal/requests" phoneRequired checkHref="/portal/check"
                 title="Book a slot for your program" />
  );
}
