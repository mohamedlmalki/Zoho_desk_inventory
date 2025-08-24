import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { ProfileSelector } from '@/components/dashboard/ProfileSelector';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Send, Mail, MessageSquare, FileText, Loader2 } from 'lucide-react';
import { Profile } from '@/App';

type ApiStatus = {
  status: 'loading' | 'success' | 'error';
  message: string;
  fullResponse?: any;
};

interface SingleInvoiceProps {
  onAddProfile: () => void;
  onEditProfile: (profile: Profile) => void;
}

const SERVER_URL = "http://localhost:3000";
let socket: Socket;

const SingleInvoice: React.FC<SingleInvoiceProps> = ({ onAddProfile, onEditProfile }) => {
  const { toast } = useToast();
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus>({ status: 'loading', message: 'Connecting to server...' });
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);

  // Form state
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Response state
  const [result, setResult] = useState<any>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const response = await fetch(`${SERVER_URL}/api/profiles`);
      if (!response.ok) throw new Error('Could not connect to the server.');
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  const inventoryProfiles = profiles.filter(p => p.inventory?.orgId);
  const selectedProfile = inventoryProfiles.find(p => p.profileName === activeProfileName) || null;

  useEffect(() => {
    if (inventoryProfiles.length > 0 && !activeProfileName) {
      setActiveProfileName(inventoryProfiles[0].profileName);
    }
  }, [inventoryProfiles, activeProfileName]);

  useEffect(() => {
    socket = io(SERVER_URL);

    socket.on('connect', () => toast({ title: "Connected to server!" }));
    socket.on('apiStatusResult', (result) => setApiStatus({
      status: result.success ? 'success' : 'error',
      message: result.message,
      fullResponse: result.fullResponse || null
    }));
    
    socket.on('singleInvoiceResult', (data) => {
        setIsProcessing(false);
        setResult(data);
        setIsResultModalOpen(true);
        toast({
            title: data.success ? "Invoice Sent Successfully" : "Invoice Creation Failed",
            description: data.message || data.error,
            variant: data.success ? "default" : "destructive",
        });
    });

    return () => {
      socket.disconnect();
    };
  }, [toast]);
  
  useEffect(() => {
    if (activeProfileName && socket?.connected) {
      setApiStatus({ status: 'loading', message: 'Checking API connection...' });
      socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'inventory' });
    }
  }, [activeProfileName, socket?.connected]);
  
  const handleProfileChange = (profileName: string) => {
    setActiveProfileName(profileName);
    toast({ title: "Profile Changed", description: `Switched to ${profileName}` });
  };
  
  const handleManualVerify = () => {
    if (!activeProfileName) return;
    setApiStatus({ status: 'loading', message: 'Checking API connection...', fullResponse: null });
    if (socket && socket.connected) {
      socket.emit('checkApiStatus', { selectedProfileName: activeProfileName, service: 'inventory' });
    }
    toast({ title: "Re-checking Connection..." });
  };

const handleCreateInvoice = async () => {
    if (!activeProfileName || !email || !subject || !body) {
      toast({ title: "Missing Information", description: "Please fill out all fields.", variant: "destructive" });
      return;
    }
    
    setIsProcessing(true);
    setResult(null);
    toast({ title: "Creating Invoice...", description: "This may take a few moments." });
    
    try {
      const response = await fetch(`${SERVER_URL}/api/invoices/single`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          subject,
          body,
          selectedProfileName: activeProfileName
        }),
      });

      const data = await response.json();

      // This is the logic that was previously in the socket listener
      setResult(data);
      setIsResultModalOpen(true);
      toast({
          title: data.success ? "Invoice Sent Successfully" : "Invoice Creation Failed",
          description: data.message || data.error,
          variant: data.success ? "default" : "destructive",
      });

    } catch (error) {
      const errorMessage = (error instanceof Error) ? error.message : "An unknown network error occurred.";
      setResult({ success: false, error: errorMessage });
      setIsResultModalOpen(true);
      toast({ title: "Network Error", description: errorMessage, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };


//------------
  return (
    <>
      <DashboardLayout onAddProfile={onAddProfile}>
        <div className="space-y-8">
          <ProfileSelector
            profiles={inventoryProfiles}
            selectedProfile={selectedProfile}
            jobs={{}}
            onProfileChange={handleProfileChange}
            apiStatus={apiStatus}
            onShowStatus={() => setIsStatusModalOpen(true)}
            onManualVerify={handleManualVerify}
            socket={socket}
            onEditProfile={onEditProfile}
          />

          <Card className="shadow-medium hover:shadow-large transition-all duration-300">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="h-5 w-5 text-primary" />
                <span>Create a Single Invoice</span>
              </CardTitle>
              <CardDescription>Fill in the details below to create one invoice in Zoho Inventory.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center space-x-2"><Mail className="h-4 w-4" /><span>Recipient Email</span></Label>
                    <Input id="email" type="email" placeholder="recipient@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={isProcessing} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subject" className="flex items-center space-x-2"><MessageSquare className="h-4 w-4" /><span>Email Subject</span></Label>
                    <Input id="subject" placeholder="Enter email subject..." value={subject} onChange={e => setSubject(e.target.value)} disabled={isProcessing} />
                  </div>
                </div>
                <div className="space-y-4 flex flex-col">
                  <div className="space-y-2 flex-grow flex flex-col">
                    <Label htmlFor="body" className="flex items-center space-x-2"><MessageSquare className="h-4 w-4" /><span>Email Body</span></Label>
                    <Textarea id="body" placeholder="Enter email body (HTML supported)..." className="flex-grow" value={body} onChange={e => setBody(e.target.value)} disabled={isProcessing} />
                  </div>
                </div>
              </div>
              <Button onClick={handleCreateInvoice} size="lg" className="w-full" disabled={isProcessing}>
                {isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : <><Send className="mr-2 h-4 w-4" /> Create and Send Invoice</>}
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
      
      <Dialog open={isResultModalOpen} onOpenChange={setIsResultModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Invoice Creation Result</DialogTitle>
            <DialogDescription>{result?.message || result?.error}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 max-h-[60vh] overflow-y-auto">
            <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border">
              {JSON.stringify(result?.fullResponse, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SingleInvoice;